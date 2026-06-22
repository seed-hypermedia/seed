import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'

const css = readFileSync(resolve(__dirname, '../hm-prose.css'), 'utf8')

function getDeclarations(selectorPattern: RegExp) {
  const ruleStart = css.search(selectorPattern)
  expect(ruleStart).toBeGreaterThanOrEqual(0)

  const declarationStart = css.indexOf('{', ruleStart)
  const declarationEnd = css.indexOf('}', declarationStart)
  return css.slice(declarationStart + 1, declarationEnd)
}

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

    const declarations = getDeclarations(selectorPatterns[0]!)

    expect(declarations).toContain('position: static;')
    expect(declarations).toContain('left: auto;')
    expect(declarations).toContain('width: 100%;')
    expect(declarations).toContain('max-width: 100%;')
    expect(declarations).toContain('transform: none;')
  })
})

describe('hm-prose video chrome', () => {
  it('applies radius and shadows to actual video players instead of the wrapper', () => {
    const lightPlayerSelector =
      /\.hm-prose\s+\[data-content-type='video'\]\s+video,\s*\.hm-prose\s+\[data-content-type='video'\]\s+iframe/
    const darkPlayerSelector =
      /\.dark\s+\.hm-prose\s+\[data-content-type='video'\]\s+video,\s*\.dark\s+\.hm-prose\s+\[data-content-type='video'\]\s+iframe,\s*\[data-theme='dark'\]\s+\.hm-prose\s+\[data-content-type='video'\]\s+video,\s*\[data-theme='dark'\]\s+\.hm-prose\s+\[data-content-type='video'\]\s+iframe/

    const lightPlayerDeclarations = getDeclarations(lightPlayerSelector)
    expect(lightPlayerDeclarations).toContain('border-radius: 0.75rem;')
    expect(lightPlayerDeclarations).toContain('box-shadow:')

    const darkPlayerDeclarations = getDeclarations(darkPlayerSelector)
    expect(darkPlayerDeclarations).toContain('box-shadow:')

    const wrapperChromeSelector = /\.hm-prose\s+\[data-content-type='video'\]\s*\{/
    const wrapperChromeRuleStart = css.search(wrapperChromeSelector)
    expect(wrapperChromeRuleStart).toBe(-1)
  })
})
