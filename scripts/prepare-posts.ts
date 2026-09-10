import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import fg from 'fast-glob'
import matter from 'gray-matter'
import { slugifyTaxonomy } from '../src/utils/taxonomy'

const sourceRoot = resolve(process.cwd(), '_posts')
const outputRoot = resolve(process.cwd(), '.generated/posts')
const removedSlugs = new Set([
  'Most received gifts',
  'Donuts and bar graphs',
  'Pick a die',
])

function dateOnly(value: unknown, fallback: string, file: string): string {
  if (value === undefined || value === null || value === '')
    return fallback

  const date = value instanceof Date ? value.toISOString() : String(value)
  const match = date.match(/^\d{4}-\d{2}-\d{2}/)
  if (!match)
    throw new Error(`${file}: unsupported date ${JSON.stringify(value)}`)
  return match[0]
}

function strings(value: unknown, field: string, file: string): string[] {
  if (!Array.isArray(value))
    throw new Error(`${file}: ${field} must be an array`)

  return value.filter(item => item !== null).map((item) => {
    if (typeof item !== 'string' || !item.trim())
      throw new Error(`${file}: ${field} contains a non-string value`)
    return item
  })
}

function assertUniqueTaxonomy(values: Map<string, string>, value: string, file: string) {
  const slug = slugifyTaxonomy(value)
  if (!slug)
    throw new Error(`${file}: taxonomy value has an empty URL slug: ${JSON.stringify(value)}`)

  const previous = values.get(slug)
  if (previous && previous !== value)
    throw new Error(`${file}: taxonomy slug collision: ${JSON.stringify(previous)} and ${JSON.stringify(value)}`)
  values.set(slug, value)
}

const files = await fg('**/*.md', { cwd: sourceRoot, onlyFiles: true })
if (files.length === 0)
  throw new Error('no posts found under _posts')

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

const slugs = new Set<string>()
const taxonomy = new Map<string, string>()
let rawPairs = 0

for (const file of files.sort()) {
  const filename = basename(file)
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/)
  if (!match)
    throw new Error(`${file}: expected YYYY-MM-DD-slug.md`)

  const [, filenameDate, slug] = match
  if (removedSlugs.has(slug))
    throw new Error(`${file}: removed coding-test post must stay deleted`)
  if (slugs.has(slug))
    throw new Error(`${file}: duplicate article slug ${slug}`)
  slugs.add(slug)

  const source = await readFile(resolve(sourceRoot, file), 'utf8')
  const parsed = matter(source)
  const title = parsed.data.title
  if (typeof title !== 'string' || !title.trim())
    throw new Error(`${file}: title is required`)

  const categories = strings(parsed.data.categories, 'categories', file)
  const tags = strings(parsed.data.tags, 'tags', file)
  for (const value of [...categories, ...tags])
    assertUniqueTaxonomy(taxonomy, value, file)

  let rawOpen = 0
  let rawClose = 0
  const contentLines = parsed.content.split(/(?<=\n)/)
  const content = contentLines.filter((line) => {
    const lineWithoutEnding = line.replace(/\r?\n$/, '')
    if (/^[\t ]*\{%\s*raw\s*%\}[\t ]*$/.test(lineWithoutEnding)) {
      rawOpen++
      return false
    }
    if (/^[\t ]*\{%\s*endraw\s*%\}[\t ]*$/.test(lineWithoutEnding)) {
      rawClose++
      return false
    }
    return true
  }).join('')
  if (rawOpen !== rawClose)
    throw new Error(`${file}: unmatched Liquid raw wrappers`)
  rawPairs += rawOpen

  if (/\{%\s*(?:raw|endraw)\s*%\}/.test(content))
    throw new Error(`${file}: non-standalone Liquid raw wrapper`)

  const frontmatter = {
    title,
    published: dateOnly(parsed.data.date, filenameDate, file),
    ...(typeof parsed.data.description === 'string' && { description: parsed.data.description }),
    categories,
    tags,
    ...(parsed.data.mermaid === true && { mermaid: true }),
    abbrlink: slug,
  }

  let output = matter.stringify(content, frontmatter)
  if (!content.endsWith('\n'))
    output = output.replace(/\n$/, '')
  await writeFile(resolve(outputRoot, `${slug}.md`), output)
}

const generated = await fg('*.md', { cwd: outputRoot, onlyFiles: true })
if (generated.length !== files.length)
  throw new Error(`expected ${files.length} generated posts, found ${generated.length}`)

console.log(`Prepared ${generated.length} posts from _posts (${rawPairs} Liquid raw pairs removed).`)
