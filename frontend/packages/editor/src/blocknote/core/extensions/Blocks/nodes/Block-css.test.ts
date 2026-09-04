import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

const css = readFileSync(resolve(__dirname, 'Block.module.css'), 'utf8')

describe('list marker layout', () => {
  it('disables layout containment on native list items', () => {
    expect(css).toMatch(
      /\.blockChildren\[data-list-type='Unordered'\]\s*>\s*\.blockNode,\s*\.blockChildren\[data-list-type='Ordered'\]\s*>\s*\.blockNode\s*\{[^}]*contain:\s*none;/s,
    )
  })

  it('does not render a marker for an invisible structural slot', () => {
    expect(css).toMatch(
      /\.blockChildren\[data-list-type='Unordered'\]\s*>\s*\.blockNode:has\(> \.blockContent\[data-content-type='slot'\]\),\s*\.blockChildren\[data-list-type='Ordered'\]\s*>\s*\.blockNode:has\(> \.blockContent\[data-content-type='slot'\]\)\s*\{[^}]*display:\s*block\s*!important;/s,
    )
  })
})
