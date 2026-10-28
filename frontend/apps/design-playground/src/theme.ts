/** Theme mode used by the shared CSS selectors. */
export type Mode = 'light' | 'dark'
/** Custom properties grouped by theme mode. */
export type Tokens = Record<Mode, Record<string, string>>
/** Portable playground state; manual color edits take precedence over presets. */
export interface ThemeState {
  mode: Mode
  hue: number | null
  neutral: string
  radius: string
  sans: string
  serif: string
  shadow: number
  overrides: Tokens
}
/** An untouched state preserves the exact shared Seed palette. */
export function defaultState(): ThemeState {
  return {
    mode: 'light',
    hue: null,
    neutral: '',
    radius: '',
    sans: '',
    serif: '',
    shadow: 1,
    overrides: {light: {}, dark: {}},
  }
}
/** Extract literal declarations, ignoring comments and Tailwind's @theme mappings. */
export function parseTheme(css: string): Tokens {
  const result: Tokens = {light: {}, dark: {}}
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(:root|\.dark)\s*\{([^}]+)\}/g)) {
    const mode = match[1] === ':root' ? 'light' : 'dark'
    for (const declaration of match[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      result[mode][declaration[1]!] = declaration[2]!.trim().replace(/\s+/g, ' ')
    }
  }
  return result
}
/** Discover color properties from their values, not a hard-coded token inventory. */
export function colorNames(tokens: Tokens): string[] {
  return [...new Set([...Object.keys(tokens.light), ...Object.keys(tokens.dark)])]
    .filter((name) =>
      /^(#|(?:rgb|hsl|oklch|oklab|lch|lab|color|color-mix|var)\(|white$|black$|transparent$|currentColor$)/i.test(
        tokens.light[name] ?? tokens.dark[name]!,
      ),
    )
    .sort()
}
/** Build twelve perceptually spaced colors; dark mode reverses the light scale. */
export function brandScale(hue: number): Tokens {
  const light: Record<string, string> = {}
  const dark: Record<string, string> = {}
  const normalized = ((hue % 360) + 360) % 360
  for (let i = 0; i < 12; i++) {
    const l = 0.25 + i * 0.064
    const c = Math.max(0.025, 0.14 * (1 - Math.abs(l - 0.57) / 0.55))
    light['--brand-' + (i + 1)] = 'oklch(' + l.toFixed(4) + ' ' + c.toFixed(4) + ' ' + normalized.toFixed(2) + ')'
  }
  for (let i = 1; i <= 12; i++) dark['--brand-' + i] = light['--brand-' + (13 - i)]!
  return {light, dark}
}
/** Turn preset controls and per-mode edits into custom-property overrides. */
export function themeOverrides(source: Tokens, state: ThemeState): Tokens {
  const result: Tokens = {light: {}, dark: {}}
  if (state.hue !== null) {
    const brand = brandScale(state.hue)
    for (const mode of ['light', 'dark'] as const) {
      Object.assign(result[mode], brand[mode], {
        '--brand': mode === 'light' ? 'var(--brand-5)' : 'var(--brand-8)',
        '--primary': 'var(--brand)',
        '--ring': 'var(--brand)',
        '--sidebar-primary': 'var(--brand)',
        '--sidebar-ring': 'var(--brand)',
      })
    }
  }
  if (state.neutral) {
    const [c, hue] = (
      {neutral: [0, 0], slate: [0.016, 255], stone: [0.008, 65], zinc: [0.008, 285]} as Record<string, number[]>
    )[state.neutral]!
    for (const mode of ['light', 'dark'] as const) {
      const dark = mode === 'dark'
      const color = (l: number) => 'oklch(' + l + ' ' + c + ' ' + hue + ')'
      Object.assign(result[mode], {
        '--background': color(dark ? 0.205 : 0.98),
        '--foreground': color(dark ? 0.922 : 0.269),
        '--card': color(dark ? 0.269 : 1),
        '--card-foreground': color(dark ? 0.922 : 0.269),
        '--popover': color(dark ? 0.269 : 1),
        '--popover-foreground': color(dark ? 0.922 : 0.269),
        '--muted': color(dark ? 0.269 : 0.96),
        '--muted-foreground': color(dark ? 0.716 : 0.51),
        '--border': color(dark ? 0.34 : 0.928),
        '--sidebar': color(dark ? 0.168 : 0.965),
        '--sidebar-foreground': color(dark ? 0.922 : 0.269),
        '--sidebar-border': color(dark ? 0.34 : 0.928),
        '--panel': color(dark ? 0.205 : 1),
        '--panel-background': 'var(--background)',
        '--input': 'var(--muted)',
      })
    }
  }
  for (const mode of ['light', 'dark'] as const) {
    if (state.radius) result[mode]['--radius'] = state.radius + 'rem'
    if (state.sans) result[mode]['--font-sans'] = state.sans
    if (state.serif) result[mode]['--font-serif'] = state.serif
    if (state.shadow !== 1) {
      for (const [name, value] of Object.entries(source[mode])) {
        if (name.startsWith('--shadow'))
          result[mode][name] = value.replace(
            /\/\s*([\d.]+)\)/g,
            (_, alpha) => '/ ' + (Number(alpha) * state.shadow).toFixed(3) + ')',
          )
      }
    }
    Object.assign(result[mode], state.overrides[mode])
  }
  return result
}
/** Serialize only differences from the shared theme, ready to paste into theme.css. */
export function overrideCss(overrides: Tokens, defaults: Tokens): string {
  return (['light', 'dark'] as const)
    .map((mode) => {
      const entries = Object.entries(overrides[mode])
        .filter(([name, value]) => value !== (defaults[mode][name] ?? defaults.light[name]))
        .sort(([a], [b]) => a.localeCompare(b))
      return entries.length
        ? (mode === 'light' ? ':root' : '.dark') +
            ' {\n' +
            entries.map(([name, value]) => '  ' + name + ': ' + value + ';').join('\n') +
            '\n}'
        : ''
    })
    .filter(Boolean)
    .join('\n\n')
}
/** Encode the complete state, including Unicode font names, without a backend. */
export function encodeHash(state: ThemeState): string {
  return '#theme=' + encodeURIComponent(JSON.stringify(state))
}
/** Validate untrusted shared-link state before any values reach the injected stylesheet. */
export function decodeHash(hash: string, defaults: Tokens): ThemeState | null {
  try {
    if (!hash.startsWith('#theme=') || hash.length > 100000) return null
    const data = JSON.parse(decodeURIComponent(hash.slice(7)))
    if (!data || !['light', 'dark'].includes(data.mode)) return null
    const state = defaultState()
    state.mode = data.mode
    if (
      data.hue !== null &&
      (typeof data.hue !== 'number' || !Number.isFinite(data.hue) || data.hue < 0 || data.hue > 360)
    )
      return null
    state.hue = data.hue
    if (!['', 'neutral', 'slate', 'stone', 'zinc'].includes(data.neutral)) return null
    if (!['', '0', '0.25', '0.375', '0.5', '0.75', '1'].includes(data.radius)) return null
    const safe = (value: unknown): value is string =>
      typeof value === 'string' && value.length <= 500 && !/[;{}<>\\]|url\s*\(|@/i.test(value)
    if (
      !safe(data.sans) ||
      !safe(data.serif) ||
      typeof data.shadow !== 'number' ||
      !Number.isFinite(data.shadow) ||
      data.shadow < 0 ||
      data.shadow > 2
    )
      return null
    Object.assign(state, {
      neutral: data.neutral,
      radius: data.radius,
      sans: data.sans,
      serif: data.serif,
      shadow: data.shadow,
    })
    const names = new Set(colorNames(defaults))
    for (const mode of ['light', 'dark'] as const) {
      if (!data.overrides?.[mode] || typeof data.overrides[mode] !== 'object' || Array.isArray(data.overrides[mode]))
        return null
      for (const [name, value] of Object.entries(data.overrides[mode])) {
        if (!names.has(name) || !safe(value) || !value) return null
        state.overrides[mode][name] = value
      }
    }
    return state
  } catch {
    return null
  }
}
/** WCAG 2 relative luminance ratio, compositing translucent colors over the background. */
export function contrastRatio(foreground: readonly number[], background: readonly number[]): number {
  const bg = background.slice(0, 3).map((channel) => channel * (background[3] ?? 1) + 255 * (1 - (background[3] ?? 1)))
  const fg = foreground
    .slice(0, 3)
    .map((channel, i) => channel * (foreground[3] ?? 1) + bg[i]! * (1 - (foreground[3] ?? 1)))
  const luminance = (rgb: readonly number[]) =>
    rgb
      .map((c) => c / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0)
  const a = luminance(fg),
    b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
