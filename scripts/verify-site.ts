import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { runInNewContext } from 'node:vm'
import glob from 'fast-glob'
import { parse } from 'node-html-parser'

const distDir = 'dist'
const siteOrigin = 'https://yousangson.github.io'
const removedPostPaths = [
  '/posts/Most-received-gifts/',
  '/posts/Donuts-and-bar-graphs/',
  '/posts/Pick-a-die/',
]
const forbiddenDemoTrackerValues = [
  'https://retypeset-comment.radishzz.cc',
  'https://views.radishzz.cc/script.js',
  'dab0e4b9-9cbf-43c3-af60-b09d3b545c38',
]
const failures: string[] = []

function check(condition: unknown, message: string) {
  if (!condition)
    failures.push(message)
}

function publicPathForHtml(file: string) {
  if (file === 'index.html')
    return '/'
  if (file.endsWith('/index.html'))
    return `/${file.slice(0, -'index.html'.length)}`
  return `/${file}`
}

function outputFileForPathname(pathname: string, files: Set<string>) {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  }
  catch {
    return undefined
  }

  const relative = path.posix.normalize(decoded).replace(/^\/+/, '')
  const direct = relative || 'index.html'
  if (files.has(direct))
    return direct

  const index = path.posix.join(relative, 'index.html')
  return files.has(index) ? index : undefined
}

function internalUrl(value: string, from: string) {
  try {
    const url = new URL(value, `${siteOrigin}${from}`)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === siteOrigin
      ? url
      : undefined
  }
  catch {
    return undefined
  }
}

async function checkSourcePosts() {
  const diff = spawnSync('git', ['diff', '--quiet', 'origin/master', '--', '_posts'])
  check(diff.status === 0, diff.status === 1
    ? '_posts differs from origin/master'
    : `could not compare _posts with origin/master (git exit ${diff.status ?? 'unknown'})`)

  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', '_posts'], { encoding: 'utf8' })
  check(untracked.status === 0, 'could not inspect untracked files under _posts')
  check(!untracked.stdout.trim(), `untracked files under _posts: ${untracked.stdout.trim()}`)
}

async function checkUrlsAndReferences() {
  const [manifestText, filesList, htmlFiles, sourcePosts] = await Promise.all([
    fs.readFile('scripts/existing-urls.json', 'utf8'),
    glob('**/*', { cwd: distDir, onlyFiles: true, dot: true }),
    glob('**/*.html', { cwd: distDir }),
    glob('_posts/**/*.{md,markdown}'),
  ])
  const files = new Set(filesList)
  const existingUrls = JSON.parse(manifestText) as string[]
  const existingPaths = existingUrls.map(value => new URL(value))

  check(new Set(existingUrls).size === existingUrls.length, 'existing URL manifest contains duplicates')
  for (const url of existingPaths) {
    check(url.origin === siteOrigin, `unexpected origin in baseline URL: ${url.href}`)
    check(Boolean(outputFileForPathname(url.pathname, files)), `missing baseline URL: ${url.href}`)
  }

  const builtPosts = await glob('posts/**/index.html', { cwd: distDir })
  check(builtPosts.length === sourcePosts.length, `post count differs: ${sourcePosts.length} sources, ${builtPosts.length} outputs`)
  for (const removedPath of removedPostPaths)
    check(!outputFileForPathname(removedPath, files), `removed post was rebuilt: ${removedPath}`)

  for (const required of ['search/index.html', 'pagefind/pagefind-entry.json', 'pagefind/pagefind.js', 'pagefind/pagefind-ui.js', 'pagefind/pagefind-ui.css'])
    check(files.has(required), `missing search artifact: ${required}`)

  const roots = new Map<string, ReturnType<typeof parse>>()
  for (const htmlFile of htmlFiles)
    roots.set(htmlFile, parse(await fs.readFile(path.join(distDir, htmlFile), 'utf8')))

  const checkReference = (raw: string, sourceFile: string, sourceUrl: string, verifyHash: boolean) => {
    const url = internalUrl(raw.trim(), sourceUrl)
    if (!url)
      return

    const targetFile = outputFileForPathname(url.pathname, files)
    if (!targetFile) {
      failures.push(`${sourceFile}: broken internal reference ${raw}`)
      return
    }

    if (!verifyHash || !url.hash || !targetFile.endsWith('.html'))
      return

    let hash: string
    try {
      hash = decodeURIComponent(url.hash.slice(1))
    }
    catch {
      failures.push(`${sourceFile}: invalid hash encoding ${raw}`)
      return
    }
    const target = roots.get(targetFile)
    const anchors = target?.querySelectorAll('[id], [name]') ?? []
    check(anchors.some(node => node.getAttribute('id') === hash || node.getAttribute('name') === hash), `${sourceFile}: missing hash target ${raw}`)
  }

  for (const [htmlFile, root] of roots) {
    const sourceUrl = publicPathForHtml(htmlFile)
    for (const node of root.querySelectorAll('a[href], area[href]'))
      checkReference(node.getAttribute('href') ?? '', htmlFile, sourceUrl, true)

    for (const node of root.querySelectorAll('img[src], source[src], video[poster], script[src], link[href]')) {
      const attribute = node.hasAttribute('poster') ? 'poster' : node.hasAttribute('src') ? 'src' : 'href'
      checkReference(node.getAttribute(attribute) ?? '', htmlFile, sourceUrl, false)
    }

    for (const node of root.querySelectorAll('img[srcset], source[srcset]')) {
      for (const candidate of (node.getAttribute('srcset') ?? '').split(','))
        checkReference(candidate.trim().split(/\s+/, 1)[0], htmlFile, sourceUrl, false)
    }
  }

  for (const cssFile of await glob('**/*.css', { cwd: distDir })) {
    const css = await fs.readFile(path.join(distDir, cssFile), 'utf8')
    for (const match of css.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g)) {
      if (!match[2].startsWith('#'))
        checkReference(match[2], cssFile, `/${cssFile}`, false)
    }
  }

  const searchableFiles = await glob('**/*.{html,js,css,xml,json}', { cwd: distDir })
  for (const file of searchableFiles) {
    const content = await fs.readFile(path.join(distDir, file), 'utf8')
    for (const value of forbiddenDemoTrackerValues)
      check(!content.includes(value), `${file}: contains Retypeset demo tracker value ${value}`)
  }
}

async function checkRetireServiceWorker() {
  const worker = await fs.readFile(path.join(distDir, 'sw.min.js'), 'utf8')
  const listeners = new Map<string, (event: { waitUntil: (promise: Promise<unknown>) => void }) => void>()
  const deleted: string[] = []
  let claimed = 0
  let unregistered = 0
  let skipped = 0
  const caches = {
    keys: async () => ['chirpy-static', 'unrelated-cache', 'chirpy-dynamic'],
    delete: async (name: string) => {
      deleted.push(name)
      return true
    },
  }
  const self = {
    addEventListener: (name: string, listener: (event: { waitUntil: (promise: Promise<unknown>) => void }) => void) => listeners.set(name, listener),
    skipWaiting: async () => { skipped++ },
    clients: { claim: async () => { claimed++ } },
    registration: { unregister: async () => { unregistered++ } },
  }
  runInNewContext(worker, { caches, self }, { filename: 'dist/sw.min.js' })

  const dispatch = async (name: string) => {
    let pending: Promise<unknown> | undefined
    listeners.get(name)?.({ waitUntil: (promise) => {
      pending = Promise.resolve(promise)
    } })
    await pending
  }
  await dispatch('install')
  await dispatch('activate')

  check(skipped === 1, 'retire service worker must call skipWaiting during install')
  check(claimed === 1, 'retire service worker must claim clients during activate')
  check(unregistered === 1, 'retire service worker must unregister during activate')
  check(deleted.sort().join(',') === 'chirpy-dynamic,chirpy-static', `retire service worker deleted wrong caches: ${deleted.join(',')}`)
}

if (process.argv.includes('--preserve-source')) {
  await checkSourcePosts()
}
await checkUrlsAndReferences()
await checkRetireServiceWorker()

if (failures.length)
  throw new Error(`Site verification failed:\n- ${failures.join('\n- ')}`)

console.log('Site verification passed')
