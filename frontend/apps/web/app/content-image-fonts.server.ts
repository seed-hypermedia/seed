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
 * undetermined, already covered by the bundled Inter font) and `emoji` (out of
 * scope) — resolve to no fetch.
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

/** Maximum number of font fetches to keep cached; oldest is evicted on insert. */
const FONT_CACHE_MAX = 200

/** In-memory cache of in-flight/loaded font fetches, keyed by family:weight:text. */
const fontCache = new Map<string, Promise<SatoriFont>>()

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

/** Fetch a font weight, caching the in-flight promise and dropping it on failure. */
function fetchFontCached(family: string, weight: number, text: string): Promise<SatoriFont> {
  const key = `${family}:${weight}:${text}`
  const cached = fontCache.get(key)
  if (cached) return cached
  const promise = fetchFont(family, weight, text).catch((error) => {
    fontCache.delete(key)
    throw error
  })
  fontCache.set(key, promise)
  // Bound the cache: evict the oldest entry (Map preserves insertion order)
  // once the cap is exceeded.
  if (fontCache.size > FONT_CACHE_MAX) {
    const oldestKey = fontCache.keys().next().value
    if (oldestKey !== undefined) fontCache.delete(oldestKey)
  }
  return promise
}

/**
 * Load fallback fonts for non-Latin text segments, for use as satori's
 * `loadAdditionalAsset` option.
 *
 * Satori calls this with a language code and the text segment it detected. We
 * fetch the matching Noto Sans family from Google Fonts (weights 400 and 700
 * in parallel, subset to the segment so the payload is tiny), and return the
 * font buffers. Emoji is out of scope (no font fetched). `unknown` (Latin /
 * undetermined) is already covered by the bundled Inter font, so no font is
 * fetched for it either.
 *
 * Failures (non-OK response, no font URL, timeout) are logged and the offending
 * font is omitted — this function never throws, so the image still renders
 * (tofu boxes are the visual fallback when a font is missing).
 */
export async function loadFallbackFonts(languageCode: string, text: string): Promise<SatoriFont[]> {
  const family = LANGUAGE_FONT_FAMILY[languageCode]
  if (!family) return []
  const fonts = await Promise.all(
    [400, 700].map(async (weight) => {
      try {
        return await fetchFontCached(family, weight, text)
      } catch (error) {
        console.error(`content-image-fonts: failed to load ${family} weight ${weight} for "${text}":`, error)
        return null
      }
    }),
  )
  return fonts.filter((font): font is SatoriFont => font !== null)
}
