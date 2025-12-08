import {useEffect, useRef} from 'react'
import {HMSearchRequest} from '../hm-types'
import {useUniversalClient} from '../routing'
import {useRecents} from './recents'
import {SearchResultItem} from './search'

export function useInlineMentions(
  perspectiveAccountUid?: string | null | undefined,
) {
  const client = useUniversalClient()
  const recents = useRecents()
  const recentsRef = useRef<SearchResultItem[]>([])
  useEffect(() => {
    recentsRef.current =
      recents.data?.map((recent) => ({
        id: recent.id,
        title: recent.name,
        subtitle: '',
        icon: '',
        parentNames: [],
        searchQuery: '',
        type: 'document',
      })) ?? []
  }, [recents])

  async function onMentionsQuery(query: string) {
    const resp = await client.request<HMSearchRequest>('Search', {
      query,
      perspectiveAccountUid: perspectiveAccountUid || undefined,
      includeBody: false,
    })
    const alreadySeenIds = new Set<string>()
    const entities: SearchResultItem[] = []
    resp.entities.forEach((result) => {
      if (!alreadySeenIds.has(result.id.id)) {
        alreadySeenIds.add(result.id.id)
        entities.push(result)
      }
    })
    const emptyRespose: InlineMentionsResult = {
      Sites: [],
      Documents: [],
      Recents: [],
      Contacts: [],
    }
    if (!entities.length) {
      return {
        Sites: [],
        Documents: [],
        Contacts: [],
        Recents: recentsRef.current,
      } as InlineMentionsResult
    }
    const response = entities.reduce((acc: InlineMentionsResult, entity) => {
      if (entity.type === 'contact') {
        acc.Contacts.push(entity)
      } else if (entity.id?.path?.length) {
        acc.Documents.push(entity)
      } else {
        acc.Sites.push(entity)
      }
      return acc
    }, emptyRespose)
    return response
  }

  return {
    onMentionsQuery,
  }
}

export type InlineMentionsResult = {
  Sites: Array<SearchResultItem>
  Documents: Array<SearchResultItem>
  Recents: Array<SearchResultItem>
  Contacts: Array<SearchResultItem>
}
