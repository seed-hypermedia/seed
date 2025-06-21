import {hmIdPathToEntityQueryPath, UnpackedHypermediaId} from '@shm/shared'
import {ListAPIResponse} from '@shm/shared/src/api-types'
import {unpackHmId} from '@shm/shared/src/utils/entity-id-url'
import {useInfiniteQuery, useQuery} from '@tanstack/react-query'
import {getApiHost} from './queryClient'

async function getAPI<ReturnType>(path: string) {
  const response = await fetch(`${getApiHost()}/api/${path}`)
  return (await response.json()) as ReturnType
}

export function useRootDocuments() {
  return useQuery({
    queryKey: ['rootDocuments'],
    queryFn: () => getAPI<ListAPIResponse>('list'),
  })
}

export function useEntity(hmId: UnpackedHypermediaId) {
  let url = `entity/${hmId.type}/${hmId.uid}${hmIdPathToEntityQueryPath(
    hmId.path,
  )}`
  if (hmId.version) {
    url += `?v=${hmId.version}`
  }
  return useQuery({
    queryKey: ['entity', hmId],
    queryFn: () => getAPI<any>(url),
  })
}

export function useFeed(pageToken?: string, pageSize: number = 10) {
  return useQuery({
    queryKey: ['feed', pageToken, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (pageToken) params.append('nextPageToken', pageToken)
      params.append('pageSize', pageSize.toString())

      const result = await getAPI<any>(`feed?${params.toString()}`)
      return {
        events: result.events.map((event: any) => {
          return {
            ...event,
            account: `hm://${event.account}`,
            newBlob: {
              ...event.newBlob,
              cid: `ipfs://${event.newBlob.cid}`,
              author: `hm://${event.newBlob.author}`,
            },
          }
        }),
        nextPageToken: result.nextPageToken,
      }
    },
  })
}

export function useInfiniteFeed(pageSize: number = 10) {
  return useInfiniteQuery({
    queryKey: ['infinite-feed', pageSize],
    queryFn: async ({pageParam}) => {
      const params = new URLSearchParams()
      if (pageParam) params.append('nextPageToken', pageParam)
      params.append('pageSize', pageSize.toString())

      const result = await getAPI<any>(`feed?${params.toString()}`)
      return {
        events: result.events.map((event: any) => {
          return {
            ...event,
            account: `hm://${event.account}`,
            newBlob: {
              ...event.newBlob,
              cid: `ipfs://${event.newBlob.cid}`,
              author: `hm://${event.newBlob.author}`,
            },
          }
        }),
        nextPageToken: result.nextPageToken,
      }
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextPageToken,
  })
}

export function useCID(cid: string | undefined) {
  return useQuery({
    queryKey: ['cid', cid],
    queryFn: () => getAPI<any>(`cid/${cid}`),
    enabled: !!cid,
  })
}

export function useComments(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ['comments', hmId.id],
    queryFn: () =>
      getAPI<any>(
        `comments/d/${hmId.uid}${hmIdPathToEntityQueryPath(hmId.path)}`,
      ),
    enabled: hmId.type === 'd',
  })
}

export function useAuthoredComments(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ['authored-comments', hmId.id],
    queryFn: () => getAPI<any>(`authored-comments/d/${hmId.uid}`),
    enabled: hmId.type === 'd' && !hmId.path?.filter((p) => !!p).length,
  })
}

export function useCitations(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ['citations', hmId.id],
    queryFn: () =>
      getAPI<any>(
        `citations/${hmId.type}/${hmId.uid}${hmIdPathToEntityQueryPath(
          hmId.path,
        )}`,
      ),
    enabled: hmId.type === 'd',
  })
}

export function useChanges(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ['changes', hmId.id],
    queryFn: () =>
      getAPI<any>(`changes/${hmId.uid}${hmIdPathToEntityQueryPath(hmId.path)}`),
    enabled: hmId.type === 'd',
  })
}

export function useCapabilities(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ['capabilities', hmId.id],
    queryFn: () =>
      getAPI<any>(
        `capabilities/${hmId.uid}${hmIdPathToEntityQueryPath(hmId.path)}`,
      ),
    enabled: hmId.type === 'd',
  })
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string | null {
  const regex = /^ipfs:\/\/(.+)$/
  const match = cidOrIPFSUrl.match(regex)
  return match ? match[1] : null
}

export async function search(input: string) {
  console.log('searching', input)
  const cid = extractIpfsUrlCid(input)
  if (cid) {
    return {destination: `/ipfs/${cid}`}
  }
  if (input.startsWith('hm://')) {
    const unpackedId = unpackHmId(input)
    if (unpackedId) {
      return {
        destination: `/hm/${unpackedId.uid}/${unpackedId.path?.join('/')}`,
      }
    }
  }
  if (input.match(/\./)) {
    // it might be a url
    const hasProtocol = input.match(/^https?:\/\//)
    const searchUrl = hasProtocol ? input : `https://${input}`
    const result = await fetch(searchUrl, {
      method: 'OPTIONS',
    })
    const id = result.headers.get('x-hypermedia-id')
    const unpackedId = id && unpackHmId(id)
    const version = result.headers.get('x-hypermedia-version')
    console.log('version', unpackedId, version)
    // const title = result.headers.get("x-hypermedia-title");
    if (unpackedId) {
      return {
        destination: `/hm/${unpackedId.uid}/${unpackedId.path?.join(
          '/',
        )}?v=${version}`,
      }
    }
  }
  return {
    errorMessage:
      'Invalid input. Please enter a valid hypermedia URL or IPFS url.',
  }
}

export function useChildrenList(hmId: UnpackedHypermediaId) {
  return useQuery({
    queryKey: ['children-list', hmId.uid],
    queryFn: () => getAPI<any>(`list/${hmId.uid}`),
    enabled: hmId.type === 'd',
  })
}
