import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parse } from 'node-html-parser'
import remarkDirective from 'remark-directive'
import { remarkContainerDirectives } from '../src/plugins/remark-container-directives.mjs'
import { remarkLeafDirectives } from '../src/plugins/remark-leaf-directives.mjs'
import { remarkLiteralTextDirectives } from '../src/plugins/remark-literal-text-directives.mjs'

// Use the Markdown processor installed with this Astro version.
const require = createRequire(import.meta.url)
const astroRequire = createRequire(require.resolve('astro'))
const { createMarkdownProcessor } = await import(astroRequire.resolve('@astrojs/markdown-remark'))
const processor = await createMarkdownProcessor({
  syntaxHighlight: false,
  remarkPlugins: [remarkDirective, remarkLiteralTextDirectives, remarkContainerDirectives, remarkLeafDirectives],
})

// Technical notation must survive in one complete paragraph.
for (const source of [
  'P0:10이 계속 실패하는 동안 12와 15는 실행을 마쳤다.',
  '아직 실행하지 않은 P0:11을 버려도 된다는 뜻은 아니다.',
  '계정 system:serviceaccount:demo:deployer를 확인한다.',
  '시각 12:30, 비율 1:2, 주소 https://example.com을 구분한다.',
  '지원하지 않는 :label[내용]{key="value"}도 원문을 보존한다.',
]) {
  const root = parse((await processor.render(source)).code)
  assert.equal(root.childNodes.length, 1, source)
  assert.equal(root.firstChild.tagName, 'P', source)
  assert.equal(root.firstChild.textContent, source)
}

// The inline fix must preserve supported blocks and code examples.
{
  const root = parse((await processor.render([
    ':::note[안내]',
    '본문의 P0:10을 보존한다.',
    ':::',
    '',
    '::youtube{id="example"}',
    '',
    '`P0:10`',
    '',
    '```text',
    'P0:10이 실행된다.',
    '```',
  ].join('\n'))).code)
  assert.equal(root.querySelector('blockquote.admonition-note p').textContent, '본문의 P0:10을 보존한다.')
  assert.equal(root.querySelector('.admonition-title').textContent, '안내')
  assert.equal(root.querySelector('lite-youtube').getAttribute('videoid'), 'example')
  assert.equal(root.querySelector('p > code').textContent, 'P0:10')
  const code = parse(root.querySelector('pre').innerHTML).querySelector('code')
  assert.equal(code.textContent.trim(), 'P0:10이 실행된다.')
}

console.log('Markdown rendering verification passed')
