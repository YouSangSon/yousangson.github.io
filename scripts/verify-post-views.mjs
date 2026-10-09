import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function verifyPostViews(browser, base, artifactDir) {
  const site = 'https://yousangson.github.io'
  const api = 'https://busuanzi.9420.ltd/api'
  const article = '/posts/goroutine/'
  const observations = []
  const setup = async (preferences = {}, response = { success: true, data: { page_pv: 1234 } }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' })
    await context.addInitScript((preferences) => {
      // Simulate visitors only against the intercepted API; never send test writes to the provider.
      for (const [key, value] of Object.entries({ webdriver: false, doNotTrack: null, globalPrivacyControl: false, ...preferences }))
        Object.defineProperty(navigator, key, { get: () => value })
    }, preferences)
    const requests = []
    const errors = []
    await context.route(`${site}/**`, async (route) => {
      const url = new URL(route.request().url())
      const result = await fetch(`${base}${url.pathname}${url.search}`)
      await route.fulfill({ status: result.status, contentType: result.headers.get('content-type') || 'text/plain', body: Buffer.from(await result.arrayBuffer()) })
    })
    await context.route(api, async (route) => {
      const request = route.request()
      requests.push({ method: request.method(), headers: await request.allHeaders() })
      await route.fulfill({ status: response === null ? 503 : 200, contentType: 'application/json', body: JSON.stringify(response) })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(error.message))
    return { context, page, requests, errors }
  }

  const visitor = await setup()
  try {
    await visitor.context.addCookies([{ name: 'test-private-cookie', value: 'private', domain: 'busuanzi.9420.ltd', path: '/', secure: true }])
    await visitor.page.goto(`${site}${article}?q=private-search#post-content`)
    await visitor.page.waitForFunction(() => document.querySelector('[data-page-views]')?.textContent.includes('1,234'))
    assert.equal(visitor.requests.length, 1)
    assert.equal(visitor.requests[0].method, 'POST')
    assert.equal(visitor.requests[0].headers['x-bsz-referer'], `${site}${article}`)
    assert.equal(visitor.requests[0].headers.referer, undefined)
    assert.equal(visitor.requests[0].headers.cookie, undefined)
    await visitor.page.evaluate(() => {
      document.dispatchEvent(new Event('astro:page-load'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await visitor.page.locator('a[href="/"]').first().click()
    await visitor.page.locator('.featured-note .post-list-meta').scrollIntoViewIfNeeded()
    await visitor.page.locator('.featured-note [data-page-views]:not([hidden])').waitFor()
    assert.equal(visitor.requests.filter(request => request.method === 'POST').length, 1, 'home/list reads incremented article views')
    assert(visitor.requests.some(request => request.method === 'GET'))
    const lastCount = visitor.page.locator('.post-list [data-page-views]').last()
    assert(await lastCount.evaluate(element => element.hidden), 'offscreen list count loaded eagerly')
    await lastCount.locator('..').scrollIntoViewIfNeeded()
    await lastCount.filter({ visible: true }).waitFor()
    assert.equal(visitor.requests.filter(request => request.method === 'POST').length, 1, 'scrolling a list incremented article views')
    await visitor.page.goBack()
    await visitor.page.locator('[data-count="true"]:not([hidden])').waitFor()
    assert.equal(visitor.requests.filter(request => request.method === 'POST').length, 2, 'returning to an article did not count exactly once')
    const related = visitor.page.locator('.related-posts a').first()
    const relatedPath = await related.getAttribute('href')
    await related.click()
    await visitor.page.waitForURL(new URL(relatedPath, site).href)
    await visitor.page.locator(`[data-count="true"][data-path="${relatedPath}"]:not([hidden])`).waitFor()
    assert.equal(visitor.requests.filter(request => request.method === 'POST').length, 3, 'client-side navigation counted incorrectly')
    assert.equal(visitor.requests.at(-1).headers['x-bsz-referer'], new URL(relatedPath, site).href)
    for (const theme of ['light', 'dark']) {
      if (await visitor.page.locator('html').evaluate(element => element.classList.contains('dark')) !== (theme === 'dark'))
        await visitor.page.getByRole('button', { name: '밝은 테마와 어두운 테마 전환' }).click()
      await visitor.page.setViewportSize({ width: 320, height: 900 })
      assert(await visitor.page.locator('[data-count="true"]').isVisible())
      assert(await visitor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'view count caused mobile overflow')
      if (artifactDir)
        await visitor.page.screenshot({ path: path.join(artifactDir, `views-${theme}-320.png`) })
    }
    assert.deepEqual(visitor.errors, [])
    observations.push({ flow: 'visitor → home reads → back → related article', requests: visitor.requests })
  }
  finally {
    await visitor.context.close()
  }

  for (const preferences of [{ webdriver: true }, { doNotTrack: '1' }, { globalPrivacyControl: true }]) {
    const test = await setup(preferences)
    try {
      await test.page.goto(`${site}${article}`)
      await test.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      if (preferences.webdriver) {
        await test.page.locator('[data-page-views]:not([hidden])').waitFor()
        assert.deepEqual(test.requests.map(request => request.method), ['GET'])
      }
      else {
        assert.equal(test.requests.length, 0, 'tracking opt-out still contacted provider')
        assert.equal(await test.page.locator('[data-page-views]').isVisible(), false)
      }
      assert.deepEqual(test.errors, [])
      observations.push({ preferences, requests: test.requests.length })
    }
    finally {
      await test.context.close()
    }
  }

  for (const response of [null, { success: true, data: { page_pv: '1234' } }]) {
    const test = await setup({}, response)
    try {
      await Promise.all([test.page.waitForResponse(api), test.page.goto(`${site}${article}`)])
      await test.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await test.page.locator('[data-page-views]').isVisible(), false, 'unavailable/invalid data appeared as a count')
      assert(await test.page.locator('#post-content > p').count() > 0)
      assert.deepEqual(test.errors, [])
    }
    finally {
      await test.context.close()
    }
  }
  if (!base.startsWith(site)) {
    const local = await setup()
    try {
      await local.page.goto(`${base}${article}`)
      await local.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(local.requests.length, 0, 'local preview contacted provider')
    }
    finally {
      await local.context.close()
    }
  }
  if (artifactDir)
    await writeFile(path.join(artifactDir, 'views-flow.json'), JSON.stringify(observations, null, 2))
  console.log('View-count verification passed: article writes, read-only lists/automation, client-side navigation, privacy, opt-out, local preview, invalid/unavailable data and mobile themes (mock API only).')
}
