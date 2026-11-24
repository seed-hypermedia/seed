import type {Font} from 'satori'

/**
 * A satori font asset, matching the shape satori accepts in its `fonts` and
 * `loadAdditionalAsset` options.
 */
export type SatoriFont = Font

/**
 * Map satori language codes to the Google Fonts family that covers the script.
 * Satori emits these codes from its script-detection (see satori 0.33.x
 * `bi`/`Di` maps). Codes not in this map — including `unknown` (Latin /
 * undetermined, already covered by the bundled Inter font) and `emoji` (handled
 * separately as Twemoji images below) — resolve to no font fetch.
 */
const LANGUAGE_FONT_FAMILY: Record<string, string> = {
  'ja-JP': 'Noto Sans JP',
  'ko-KR': 'Noto Sans KR',
  'zh-CN': 'Noto Sans SC',
  'zh-TW': 'Noto Sans TC',
  'zh-HK': 'Noto Sans HK',
  'th-TH': 'Noto Sans Thai',
  'bn-IN': 'Noto Sans Bengali',
  'ar-AR': 'Noto Sans Arabic',
  'ta-IN': 'Noto Sans Tamil',
  'ml-IN': 'Noto Sans Malayalam',
  'he-IL': 'Noto Sans Hebrew',
  'te-IN': 'Noto Sans Telugu',
  devanagari: 'Noto Sans Devanagari',
  kannada: 'Noto Sans Kannada',
  symbol: 'Noto Sans Symbols 2',
  math: 'Noto Sans Math',
}

/** Pinned Twemoji release used for emoji rendering in Open Graph images. */
const TWEMOJI_VERSION = '15.1.0'

/** Base URL for Twemoji SVG assets on the jsDelivr CDN. */
const TWEMOJI_SVG_BASE = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/svg`

/** Maximum number of asset fetches to keep cached; oldest is evicted on insert. */
const ASSET_CACHE_MAX = 200

/**
 * In-memory cache of in-flight/loaded asset fetches (fonts and emoji data URLs),
 * keyed by `font:${family}:${weight}:${text}` or `emoji:${code}`. Map preserves
 * insertion order, used for oldest-first eviction.
 */
const assetCache = new Map<string, Promise<SatoriFont | string>>()

/** Parse the first `src: url(...) format('truetype'|'opentype')` URL from CSS. */
function parseFontUrl(css: string): string | null {
  const match = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/)
  if (!match || match[1] === undefined) return null
  return match[1].replace(/^['"]|['"]$/g, '')
}

/** Fetch a single font weight for a family subset to the given text. */
async function fetchFont(family: string, weight: number, text: string): Promise<SatoriFont> {
  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}` +
    `:wght@${weight}&text=${encodeURIComponent(text)}`
  const cssResponse = await fetch(cssUrl, {signal: AbortSignal.timeout(5000)})
  if (!cssResponse.ok) throw new Error(`Google Fonts CSS responded ${cssResponse.status} for ${cssUrl}`)
  const css = await cssResponse.text()
  const fontUrl = parseFontUrl(css)
  if (!fontUrl) throw new Error(`No TrueType/OpenType URL found in Google Fonts CSS for ${cssUrl}`)
  const fontResponse = await fetch(fontUrl, {signal: AbortSignal.timeout(5000)})
  if (!fontResponse.ok) throw new Error(`Font download responded ${fontResponse.status} for ${fontUrl}`)
  const data = await fontResponse.arrayBuffer()
  return {name: family, data, weight: weight as SatoriFont['weight'], style: 'normal'}
}

/** Fetch a Twemoji SVG and return it as a base64 data URL for satori. */
async function fetchTwemoji(code: string): Promise<string> {
  const svgUrl = `${TWEMOJI_SVG_BASE}/${code}.svg`
  const response = await fetch(svgUrl, {signal: AbortSignal.timeout(5000)})
  if (!response.ok) throw new Error(`Twemoji SVG responded ${response.status} for ${svgUrl}`)
  const svgText = await response.text()
  return `data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}`
}

/**
 * Fetch an asset (font or emoji), caching the in-flight promise and dropping it
 * on failure. Bounds the cache to `ASSET_CACHE_MAX` entries, evicting the
 * oldest (Map insertion order) when the cap is exceeded.
 */
function fetchCached<T extends SatoriFont | string>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = assetCache.get(key)
  if (cached) return cached as Promise<T>
  const promise = fetcher().catch((error) => {
    assetCache.delete(key)
    throw error
  })
  assetCache.set(key, promise)
  if (assetCache.size > ASSET_CACHE_MAX) {
    const oldestKey = assetCache.keys().next().value
    if (oldestKey !== undefined) assetCache.delete(oldestKey)
  }
  return promise
}

/**
 * Convert an emoji grapheme to its Twemoji code (hex codepoints joined by `-`).
 *
 * Strips FE0F variation selectors unless the grapheme contains a ZWJ (U+200D),
 * in which case the FE0F selectors are significant to the sequence and kept.
 * Matches the file naming used by the Twemoji asset CDN.
 */
export function emojiToTwemojiCode(emoji: string): string {
  const chars = emoji.includes('\u200d') ? emoji : emoji.replace(/\ufe0f/g, '')
  return [...chars].map((c) => c.codePointAt(0)!.toString(16)).join('-')
}

/**
 * Load additional assets for satori's `loadAdditionalAsset` option: fallback
 * fonts for non-Latin scripts and Twemoji SVG images for emoji.
 *
 * Satori calls this with a language code and the text segment it detected. For
 * non-Latin scripts we fetch the matching Noto Sans family from Google Fonts
 * (weights 400 and 700 in parallel, subset to the segment so the payload is
 * tiny) and return the font buffers. For emoji we fetch the Twemoji SVG for the
 * grapheme and return a base64 data URL, which satori stores as
 * `graphemeImages[segment]` and renders inline. Codes not in the language map
 * — including `unknown` (Latin, covered by Inter) — resolve to no fetch.
 *
 * Failures (non-OK response, no font URL, timeout) are logged and the offending
 * asset is omitted — this function never throws, so the image still renders
 * (tofu boxes are the visual fallback when a font or emoji is missing).
 */
export async function loadContentImageAsset(languageCode: string, segment: string): Promise<string | SatoriFont[]> {
  if (languageCode === 'emoji') {
    const code = emojiToTwemojiCode(segment)
    try {
      return await fetchCached(`emoji:${code}`, () => fetchTwemoji(code))
    } catch (error) {
      console.error(`content-image-fonts: failed to load Twemoji for "${segment}" (${code}):`, error)
      return []
    }
  }
  const family = LANGUAGE_FONT_FAMILY[languageCode]
  if (!family) return []
  const fonts = await Promise.all(
    [400, 700].map(async (weight) => {
      try {
        return await fetchCached(`font:${family}:${weight}:${segment}`, () => fetchFont(family, weight, segment))
      } catch (error) {
        console.error(`content-image-fonts: failed to load ${family} weight ${weight} for "${segment}":`, error)
        return null
      }
    }),
  )
  return fonts.filter((font): font is SatoriFont => font !== null)
}
