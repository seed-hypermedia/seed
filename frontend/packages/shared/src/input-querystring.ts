import {z} from 'zod'

/**
 * Serializes an object to a URL query string with proper type handling
 */
export function serializeQueryString<T extends Record<string, unknown>>(
  data: T,
  _schema?: z.ZodType<T>,
): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) {
      continue
    }

    // Handle primitives directly
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
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
 * Deserializes a URL query string to an object with proper type handling using Zod schema
 */
export function deserializeQueryString<T extends Record<string, unknown>>(
  queryString: string,
  schema: z.ZodType<T>,
): T {
  // Remove leading '?' if present
  const cleanQuery = queryString.startsWith('?')
    ? queryString.slice(1)
    : queryString

  if (!cleanQuery) {
    return schema.parse({})
  }

  const params = new URLSearchParams(cleanQuery)
  const result: Record<string, unknown> = {}

  for (const [key, value] of params.entries()) {
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
