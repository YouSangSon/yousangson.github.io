import { Buffer } from 'node:buffer'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import glob from 'fast-glob'
import matter from 'gray-matter'
import sharp from 'sharp'
import { getPostTopic } from '../src/utils/topics'

const output = 'dist/social'
await mkdir(output, { recursive: true })

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function wrap(value: string, width: number, maxLines: number) {
  const measure = (text: string) => [...text].reduce((sum, character) => sum + (/[\u2E80-\uFFFF]/.test(character) ? 2 : 1), 0)
  const lineCount = Math.min(maxLines, Math.max(1, Math.ceil(measure(value) / width)))
  const balancedWidth = Math.ceil(measure(value) / lineCount)
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word
    const limit = lines.length === lineCount - 1 ? width : balancedWidth
    if (measure(candidate) > limit && line) {
      lines.push(line.trim())
      line = word
    }
    else {
      line = candidate
    }
  }
  if (line.trim())
    lines.push(line.trim())
  if (lines.length > maxLines)
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, -1)}…`
  return lines.slice(0, maxLines)
}

const files = await glob('*.md', { cwd: '.generated/posts' })
for (const file of files) {
  const { data } = matter(await readFile(path.join('.generated/posts', file), 'utf8'))
  const slug = data.abbrlink as string
  if (!/^[a-z0-9-]+$/.test(slug))
    throw new Error(`Invalid social-card slug: ${file}`)
  const title = String(data.displayTitle || data.title)
  const attribution = String(data.attribution || '')
  const topic = getPostTopic(slug)?.title || '엔지니어링 노트'
  const titleLines = wrap(title, 40, 4)
  const sourceLines = wrap(attribution, 88, 2)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <rect width="1200" height="630" fill="#fbf5e8"/>
    <rect x="64" y="80" width="7" height="430" fill="#7b3f28"/>
    <g font-family="Apple SD Gothic Neo, Noto Sans CJK KR, sans-serif" fill="#2e2823">
      <text x="100" y="120" font-size="28" fill="#7b3f28">${escapeXml(topic)}</text>
      ${titleLines.map((line, index) => `<text x="100" y="${220 + index * 70}" font-size="52" font-weight="700">${escapeXml(line)}</text>`).join('')}
      ${sourceLines.map((line, index) => `<text x="100" y="${530 + index * 30}" font-size="22" fill="#57534a">${escapeXml(line)}</text>`).join('')}
      <text x="100" y="602" font-size="22">Yousang · 엔지니어링 노트</text>
    </g>
  </svg>`
  await sharp(Buffer.from(svg)).png().toFile(path.join(output, `${slug}.png`))
}
console.log(`Generated ${files.length} social cards (1200×630).`)
