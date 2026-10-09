import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { preview } from 'astro'
import { chromium } from 'playwright'
import { verifyPostViews } from './verify-post-views.mjs'

let server
let browser
const observations = []
const artifactDir = process.env.BLOG_AUDIT_DIR
try {
  let base = process.env.BLOG_BASE_URL
  if (!base) {
    server = await preview({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
    base = `http://127.0.0.1:${server.server.address().port}`
  }
  if (artifactDir)
    await mkdir(artifactDir, { recursive: true })
  browser = await chromium.launch()
  await verifyPostViews(browser, base, artifactDir)
  const context = await browser.newContext({ colorScheme: 'no-preference', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const input = page.locator('.pagefind-ui__search-input')
  const waitSearch = async term => page.waitForFunction((term) => {
    const message = document.querySelector('.pagefind-ui__message')?.textContent || ''
    return message.includes(term) && !message.includes('검색 중') && !document.querySelector('.pagefind-ui__loading')
  }, term)

  await page.goto(`${base}/search/`)
  const historyLength = await page.evaluate(() => history.length)
  await input.fill('Redis')
  await waitSearch('Redis')
  assert.equal(new URL(page.url()).searchParams.get('q'), 'Redis')
  assert.equal(await page.evaluate(() => history.length), historyLength, 'typing added history entries')
  const excerpts = await page.locator('.pagefind-ui__result-excerpt').allTextContents()
  assert(excerpts.length >= 2, 'Redis articles were not found')
  assert(excerpts.every(text => !/읽는 데|\d{4}-\d{2}-\d{2}|redis redis|목차/.test(text)), 'search excerpt contains display metadata')
  await page.locator('a[href^="/posts/redis-lock-queue-race-condition-fix/"]').first().click()
  await page.waitForURL(`${base}/posts/redis-lock-queue-race-condition-fix/`)
  await page.locator('#post-content').waitFor()
  await page.goBack()
  await waitSearch('Redis')
  assert.equal(await input.inputValue(), 'Redis', 'back navigation lost the term')
  assert.deepEqual(await page.locator('.pagefind-ui__result-excerpt').allTextContents(), excerpts, 'back navigation changed results')
  await page.reload()
  await waitSearch('Redis')
  assert.equal(await input.inputValue(), 'Redis', 'reload lost the term')
  if (artifactDir)
    await page.screenshot({ path: path.join(artifactDir, 'search-after.png') })
  observations.push({ flow: 'Redis → article → back → reload', excerpts })

  await page.locator('.pagefind-ui__search-clear').click()
  assert.equal(new URL(page.url()).searchParams.has('q'), false, 'clear left the query in the URL')
  await page.waitForFunction(() => document.querySelectorAll('.pagefind-ui__result').length === 0)
  for (const term of ['분산 락', 'GOMAXPROCS', 'Sourty']) {
    await input.fill(term)
    await waitSearch(term)
    assert(await page.locator('.pagefind-ui__result').count() > 0, `missing body/title/author search: ${term}`)
    observations.push({ query: term, results: await page.locator('.pagefind-ui__result-title').allTextContents() })
  }
  // Pagefind can fall back to a query prefix; this prefix is absent from the corpus.
  await input.fill('zzzzzzzzzzzzzzzz')
  await waitSearch('zzzzzzzzzzzzzzzz')
  assert.equal(await page.locator('.pagefind-ui__result').count(), 0, 'no-result query showed stale results')

  for (const theme of ['light', 'dark']) {
    await page.goto(`${base}/posts/flashattention-io-to-fp4-bottlenecks/`)
    if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark'))
      await page.getByRole('button', { name: '밝은 테마와 어두운 테마 전환' }).click()
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(() => document.fonts.ready)
      const geometry = await page.evaluate(() => {
        const paragraph = document.querySelector('#post-content > p')
        const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight)
        return { top: paragraph.getBoundingClientRect().top, lineHeight, viewport: innerHeight, pageWidth: document.documentElement.scrollWidth }
      })
      assert(geometry.top + 2 * geometry.lineHeight < geometry.viewport, 'first screen does not show two lines of the introduction')
      assert(geometry.pageWidth <= width + 1, `page overflows at ${width}px`)
      assert.match(await page.locator('.post-attribution').textContent(), /Tri Dao.*Ted Zadouri.*Robert Hu/)
      assert(await page.locator('.related-posts li').count() >= 2)
      if (artifactDir && [320, 1280].includes(width))
        await page.screenshot({ path: path.join(artifactDir, `article-${theme}-${width}.png`) })
      observations.push({ page: 'FlashAttention', theme, width, ...geometry })
    }
  }
  await page.goto(`${base}/posts/goroutine/`)
  const dates = await page.locator('#post-date time').allTextContents()
  assert(dates.some(date => date.includes('2024-03-04')), 'original publication date changed')
  assert(dates.some(date => date.includes('수정')), 'actual content revision date missing')
  assert(!/읽는 데/.test(await page.locator('main').textContent()), 'reading-time estimate still displayed')
  await page.goto(`${base}/`)
  const companion = page.locator('.companion-note a')
  const companionPath = await companion.getAttribute('href')
  const companionTitle = (await companion.textContent()).replace('↗', '').trim()
  assert.match(companionPath, /^\/posts\/[^/]+\/$/)
  assert(await page.locator('.companion-reason').textContent())
  await companion.click()
  await page.waitForURL(`${base}${companionPath}`)
  assert.equal((await page.locator('h1.post-title').textContent()).trim(), companionTitle)
  await page.goto(`${base}/about/`)
  assert.equal(await page.locator('main a[href^="/posts/"]').count(), 3)
  assert.equal(await page.locator('meta[property="og:type"]').getAttribute('content'), 'website')
  assert.deepEqual(errors, [], 'uncaught browser errors')
  if (artifactDir)
    await writeFile(path.join(artifactDir, 'reader-flow.json'), JSON.stringify({ base, observations, errors }, null, 2))
  console.log('Reader-flow verification passed: search snippets, URL/back/reload/clear, Korean/title/author queries, 8 theme-width cases, related posts, revision dates, home and about.')
}
finally {
  await browser?.close()
  await server?.stop()
}
