import { visit } from 'unist-util-visit'

// This site supports block directives only. Inline colons belong to the prose.
export function remarkLiteralTextDirectives() {
  return (tree, file) => {
    visit(tree, 'textDirective', (node, index, parent) => {
      parent.children[index] = {
        type: 'text',
        value: String(file).slice(node.position.start.offset, node.position.end.offset),
        position: node.position,
      }
    })
  }
}
