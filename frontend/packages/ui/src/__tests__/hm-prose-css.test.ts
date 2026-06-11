import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

const css = readFileSync(resolve(__dirname, '../hm-prose.css'), 'utf8')

describe('hm-prose grid media layout', () => {
  it('neutralizes media breakout positioning inside grid cells', () => {
    const selectorPatterns = [
      /\.hm-prose\s+\[data-node-type='blockChildren'\]\[data-list-type='Grid'\]\s*>\s*\[data-node-type='blockNode'\]:has\(> \[data-content-type='image'\]\)/,
      /\.hm-prose\s+\[data-node-type='blockChildren'\]\[data-list-type='Grid'\]\s*>\s*\[data-node-type='blockNode'\]:has\(> \[data-content-type='video'\]\)/,
      /\.hm-prose\s+\[data-node-type='blockChildren'\]\[data-list-type='Grid'\]\s*>\s*\[data-node-type='blockNode'\]:has\(> \* > \[data-content-type='image'\]\)/,
      /\.hm-prose\s+\[data-node-type='blockChildren'\]\[data-list-type='Grid'\]\s*>\s*\[data-node-type='blockNode'\]:has\(> \* > \[data-content-type='video'\]\)/,
    ]

    for (const selectorPattern of selectorPatterns) {
      expect(css).toMatch(selectorPattern)
    }

    const ruleStart = css.search(selectorPatterns[0]!)
    const declarationStart = css.indexOf('{', ruleStart)
    const declarationEnd = css.indexOf('}', declarationStart)
    const declarations = css.slice(declarationStart + 1, declarationEnd)

    expect(declarations).toContain('position: static;')
    expect(declarations).toContain('left: auto;')
    expect(declarations).toContain('width: 100%;')
    expect(declarations).toContain('max-width: 100%;')
    expect(declarations).toContain('transform: none;')
  })
})
