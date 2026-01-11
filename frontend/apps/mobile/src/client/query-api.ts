import {deserialize} from 'superjson'

// Create a queryAPI function for a specific server base URL
export function createQueryAPI(baseUrl: string) {
  return async function queryAPI<T>(url: string): Promise<T> {
    // url comes as "/api/SomeKey?params=..." - prepend base URL
    const fullUrl = `${baseUrl}${url}`

    const response = await fetch(fullUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${fullUrl}: ${response.statusText}`)
    }

    const data = await response.json()
    if (!data) {
      throw new Error('Response data is undefined')
    }

    // Unwrap superjson
    return deserialize(data) as T
  }
}
