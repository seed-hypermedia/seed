import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {
  brandScale,
  colorNames,
  contrastRatio,
  decodeHash,
  defaultState,
  encodeHash,
  overrideCss,
  parseTheme,
  themeOverrides,
  groupColors,
  extendedTokens,
  type Tokens,
  type ThemeState,
} from './theme'

const source = parseTheme(readFileSync(new URL('../../../packages/ui/src/theme.css', import.meta.url), 'utf8'))

describe('token groups and extensions', () => {
  it('groups every discovered color exactly once, including empty inventories', () => {
    const names = colorNames(source)
    const groups = groupColors(names)
    expect(Object.values(groups).flat().sort()).toEqual(names)
    expect(groups.Brand).toContain('--brand-12')
    expect(groups.Sidebar).toContain('--sidebar')
    expect(groups.Code).toContain('--hljs-blue')
    expect(Object.values(groupColors([])).flat()).toEqual([])
  })
  it('leaves the compiled default scale untouched until a control changes', () => {
    expect(extendedTokens(defaultState())).toEqual({})
  })
  it('emits the Tailwind variables used by typography, spacing and motion', () => {
    const state = {
      ...defaultState(),
      baseSize: 20,
      typeRatio: 1.25,
      lineHeight: 1.8,
      spacing: 6,
      duration: 500,
      mono: 'Consolas, monospace',
    }
    const tokens = extendedTokens(state)
    expect(tokens['--text-base']).toBe('20.000px')
    expect(tokens['--text-lg']).toBe('25.000px')
    expect(tokens['--leading-normal']).toBe('1.8')
    expect(tokens['--text-sm--line-height']).toBe('1.8')
    expect(tokens['--spacing']).toBe('6px')
    expect(tokens['--duration-normal']).toBe('500ms')
    expect(tokens['--font-mono']).toBe('Consolas, monospace')
    const overrides = themeOverrides(source, state)
    expect(overrides.light['--text-base']).toBe(tokens['--text-base'])
    expect(overrides.dark['--spacing']).toBe('6px')
    expect(overrideCss(overrides, source)).toContain('--text-lg: 25.000px;')
    expect(decodeHash(encodeHash(state), source)).toEqual(state)
  })
  it('rejects invalid extension values at the share-link boundary', () => {
    for (const patch of [
      {spacing: 0},
      {baseSize: 100},
      {typeRatio: -1},
      {lineHeight: '2'},
      {duration: 2000},
      {mono: 'red;} body{display:none'},
    ])
      expect(decodeHash(encodeHash({...defaultState(), ...patch} as ThemeState), source)).toBeNull()
  })
})

describe('theme parser', () => {
  it('reads both selectors, multiline declarations and comments without @theme aliases', () => {
    expect(
      parseTheme(
        '/* :root { --fake: red; } */ :root { --a: rgb(1, 2, 3); --font: Georgia,\nserif; } .dark { --a: white; } @theme inline { --alias: red; }',
      ),
    ).toEqual({light: {'--a': 'rgb(1, 2, 3)', '--font': 'Georgia, serif'}, dark: {'--a': 'white'}})
  })
  it('handles an empty stylesheet', () => expect(parseTheme('')).toEqual({light: {}, dark: {}}))
  it('discovers every current color, excluding typography, shadows and timing', () => {
    expect(colorNames(source)).toContain('--selection')
    expect(colorNames(source)).toContain('--brand-12')
    expect(colorNames(source)).toContain('--hljs-blue')
    expect(colorNames(source)).not.toContain('--font-serif')
    expect(colorNames(source)).not.toContain('--shadow-md')
    expect(source.dark['--primary']).toBeTruthy()
  })
})

describe('brand scale and controls', () => {
  it('generates twelve ascending lightness values and reverses them in dark mode', () => {
    const scale = brandScale(260)
    expect(Object.keys(scale.light)).toHaveLength(12)
    for (let i = 1; i <= 12; i++) expect(scale.dark['--brand-' + i]).toBe(scale.light['--brand-' + (13 - i)])
    expect(scale.light['--brand-1']).toMatch(/^oklch\(0.2500/)
    expect(scale.light['--brand-12']).toMatch(/^oklch\(0.9540/)
    expect(brandScale(-100)).toEqual(scale)
  })
  it('leaves the original Seed theme intact until a setting changes', () => {
    expect(overrideCss(themeOverrides(source, defaultState()), source)).toBe('')
  })
  it('applies settings to both modes while honoring manual overrides', () => {
    const state = {
      ...defaultState(),
      hue: 35,
      neutral: 'stone',
      radius: '1',
      shadow: 0,
      sans: 'Verdana, sans-serif',
      overrides: {light: {'--primary': 'red'}, dark: {}},
    }
    const result = themeOverrides(source, state)
    expect(result.light['--primary']).toBe('red')
    expect(result.dark['--primary']).toBe('var(--brand)')
    expect(result.dark['--radius']).toBe('1rem')
    expect(result.dark['--card']).not.toBe(result.light['--card'])
    expect(result.light['--shadow-md']).toContain('/ 0.000)')
  })
})

describe('override stylesheet', () => {
  it('writes only changed tokens in separate, deterministic blocks', () => {
    expect(
      overrideCss(
        {light: {'--background': source.light['--background']!, '--primary': '#123456'}, dark: {'--primary': 'white'}},
        source,
      ),
    ).toBe(':root {\n  --primary: #123456;\n}\n\n.dark {\n  --primary: white;\n}')
  })
  it('omits empty blocks', () => expect(overrideCss({light: {}, dark: {}}, source)).toBe(''))
})

describe('shared URL state', () => {
  it('round-trips Unicode, mode and independent token edits', () => {
    const state = {
      ...defaultState(),
      mode: 'dark' as const,
      hue: 280,
      serif: '"游明朝", serif',
      overrides: {light: {'--link': '#123456'}, dark: {'--link': 'oklch(0.8 0.1 200)'}},
    }
    expect(decodeHash(encodeHash(state), source)).toEqual(state)
  })
  it('rejects malformed, incomplete, unknown and stylesheet-injection payloads', () => {
    for (const hash of ['', '#theme=%', '#theme=null', '#theme=%7B%7D']) expect(decodeHash(hash, source)).toBeNull()
    expect(decodeHash(encodeHash({...defaultState(), hue: NaN}), source)?.hue).toBeNull()
    const invalidOverrides: Tokens[] = [
      {light: {'--unknown': 'red'}, dark: {}},
      {light: {'--primary': 'red;} body {display:none'}, dark: {}},
      {light: {'--primary': 'url(https://example.com)'}, dark: {}},
    ]
    for (const overrides of invalidOverrides)
      expect(decodeHash(encodeHash({...defaultState(), overrides}), source)).toBeNull()
  })
})

describe('WCAG contrast', () => {
  it('computes known endpoints, symmetry and the sRGB transfer curve', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21)
    expect(contrastRatio([42, 42, 42], [42, 42, 42])).toBe(1)
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBe(21)
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.478, 2)
  })
  it('composites transparent foregrounds and backgrounds', () => {
    expect(contrastRatio([0, 0, 0, 0], [255, 255, 255])).toBe(1)
    expect(contrastRatio([0, 0, 0], [0, 0, 0, 0])).toBe(21)
    expect(contrastRatio([0, 0, 0, 0.5], [255, 255, 255])).toBeCloseTo(3.977, 2)
  })
})
