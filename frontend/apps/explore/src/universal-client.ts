import {createWebUniversalClient} from '@shm/shared'
import {deserialize} from 'superjson'
import {getApiHost} from './queryClient'

export async function queryAPI<T>(url: string): Promise<T> {
  // The url comes in as "/api/..." but we need to prepend the API host
  const fullUrl = `${getApiHost()}${url}`
  const response = await fetch(fullUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${fullUrl}: ${response.statusText}`)
  }
  const data = await response.json()
  // Unwrap superjson-serialized response
  return deserialize(data) as T
}

export const exploreUniversalClient = createWebUniversalClient({
  queryAPI,
  // Explore app doesn't need comment editing
  CommentEditor: () => null as unknown as JSX.Element,
})
