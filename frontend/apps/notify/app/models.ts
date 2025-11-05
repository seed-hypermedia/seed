import {SITE_BASE_URL} from '@shm/shared/constants'
import {useQuery, UseQueryOptions} from '@tanstack/react-query'
import {unwrap} from './wrapping'

function resolveUrl(url: string): string {
  // If URL is already absolute, return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }
  // Otherwise, prefix with SITE_BASE_URL
  const baseUrl = SITE_BASE_URL.endsWith('/')
    ? SITE_BASE_URL.slice(0, -1)
    : SITE_BASE_URL
  const path = url.startsWith('/') ? url : `/${url}`
  return `${baseUrl}${path}`
}

export async function queryAPI<ResponsePayloadType>(url: string) {
  const fullUrl = resolveUrl(url)
  const response = await fetch(fullUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${fullUrl}: ${response.statusText}`)
  }
  const fullData = await response.json()
  const data = unwrap<ResponsePayloadType>(fullData)
  return data
}

export function useAPI<ResponsePayloadType>(
  url?: string,
  queryOptions?: UseQueryOptions<unknown, unknown, ResponsePayloadType>,
) {
  const query = useQuery({
    queryKey: ['api', url],
    queryFn: async () => {
      if (!url) return
      return await queryAPI<ResponsePayloadType>(url)
    },
    ...queryOptions,
  })
  return query
}
