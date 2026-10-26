/** Query namespace reserved for a custom HTML page's schema-defined input. */
export const PAGE_INPUT_PREFIX = 'p.'

/** Read page-owned query parameters without mixing in Seed navigation parameters. */
export function pageParamsFromUrl(url: string): Record<string, string> | undefined {
  const queryStart = url.indexOf('?')
  if (queryStart === -1 || (url.indexOf('#') !== -1 && url.indexOf('#') < queryStart)) return undefined
  const params = new URLSearchParams(url.slice(queryStart + 1).split('#')[0])
  const entries = Array.from(params.entries()).filter(([key]) => key.startsWith(PAGE_INPUT_PREFIX))
  return entries.length
    ? Object.fromEntries(entries.map(([key, value]) => [key.slice(PAGE_INPUT_PREFIX.length), value]))
    : undefined
}

/** Encode raw JSON parameter values for insertion into an HM or web query string. */
export function pageParamsQuery(params?: Record<string, string>): string {
  return new URLSearchParams(
    Object.entries(params || {}).map(([key, value]) => [PAGE_INPUT_PREFIX + key, value]),
  ).toString()
}

/** Decode JSON values from the URL, retaining validation errors for the page to display. */
export function decodePageInput(params: Record<string, string> = {}): {
  values: Record<string, unknown>
  errors: string[]
} {
  const values: Record<string, unknown> = Object.create(null)
  const errors: string[] = []
  if (Object.keys(params).length > 64 || pageParamsQuery(params).length > 8192)
    return {values, errors: ['Page input exceeds the URL size limit.']}
  for (const [key, value] of Object.entries(params)) {
    try {
      values[key] = JSON.parse(value, (_key, item) => {
        if (
          typeof item === 'number' &&
          (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))
        )
          throw new Error('Number cannot be represented exactly')
        return item
      })
    } catch {
      errors.push(`${key}: expected a JSON value with finite numbers and safe integers in the URL.`)
    }
  }
  return {values, errors}
}

/** Serialize a complete input state; rejects values that JSON would silently discard or change. */
export function encodePageInput(values: unknown): Record<string, string> {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Page input must be an object')
  const params = Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const json = JSON.stringify(value, (_key, item) => {
        if (
          item === undefined ||
          typeof item === 'function' ||
          typeof item === 'symbol' ||
          (typeof item === 'number' &&
            (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item))))
        )
          throw new Error('Page input must contain JSON values')
        return item
      })
      return [key, json]
    }),
  )
  const decoded = decodePageInput(params)
  if (decoded.errors.length) throw new Error(decoded.errors.join('; '))
  return params
}
