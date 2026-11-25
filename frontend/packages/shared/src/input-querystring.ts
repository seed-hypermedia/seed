import {z} from 'zod'

/**
 * Reserved query param key for non-object inputs (string, number, boolean).
 */
const PRIMITIVE_VALUE_KEY = '__value'

/**
 * Serializes data to a URL query string with proper type handling.
 * Non-object inputs (string, number, boolean) are stored under a __value key.
 */
export function serializeQueryString<T>(data: T, _schema?: z.ZodType<T>): string {
  const params = new URLSearchParams()

  // Handle non-object inputs (string, number, boolean)
  if (typeof data !== 'object' || data === null) {
    if (data !== undefined && data !== null) {
      params.append(PRIMITIVE_VALUE_KEY, String(data))
    }
    const queryString = params.toString()
    return queryString ? `?${queryString}` : ''
  }

  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined || value === null) {
      continue
    }

    // Handle primitives directly
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params.append(key, String(value))
    } else {
      // Handle complex objects/arrays as JSON
      params.append(key, JSON.stringify(value))
    }
  }

  const queryString = params.toString()
  return queryString ? `?${queryString}` : ''
}

/**
 * Deserializes a URL query string using a Zod schema.
 * If the query contains only a __value key, returns the primitive value directly.
 */
export function deserializeQueryString<T>(queryString: string, schema: z.ZodType<T>): T {
  // Remove leading '?' if present
  const cleanQuery = queryString.startsWith('?') ? queryString.slice(1) : queryString

  if (!cleanQuery) {
    return schema.parse({})
  }

  const params = new URLSearchParams(cleanQuery)

  // Handle primitive value inputs
  if (params.has(PRIMITIVE_VALUE_KEY) && Array.from(params.keys()).length === 1) {
    return schema.parse(params.get(PRIMITIVE_VALUE_KEY))
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Array.from(params.entries())) {
    // Try to parse as JSON first (for complex objects/arrays)
    try {
      result[key] = JSON.parse(value)
    } catch {
      // If JSON parsing fails, keep as string
      result[key] = value
    }
  }

  // Use Zod schema to parse and coerce to correct types
  return schema.parse(result)
}
