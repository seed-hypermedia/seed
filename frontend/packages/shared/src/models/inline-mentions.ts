import {useEffect, useRef} from 'react'
import {useUniversalClient} from '../routing'
import {useRecents} from './recents'
import {SearchResultItem} from './search'

export function useInlineMentions(perspectiveAccountUid?: string | null | undefined) {
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
    const t0 = performance.now()
    console.log(`[SEARCH-DEBUG] onMentionsQuery START | query="${query}"`)
    const resp = await client.request('Search', {
      query,
      perspectiveAccountUid: perspectiveAccountUid || undefined,
      includeBody: false,
    })
    const t1 = performance.now()
    console.log(
      `[SEARCH-DEBUG] onMentionsQuery client.request done | query="${query}" | ${(t1 - t0).toFixed(1)}ms | ${
        resp.entities.length
      } raw entities`,
    )
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
      const t2 = performance.now()
      console.log(
        `[SEARCH-DEBUG] onMentionsQuery END (no results) | query="${query}" | total=${(t2 - t0).toFixed(1)}ms`,
      )
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
    const t2 = performance.now()
    console.log(
      `[SEARCH-DEBUG] onMentionsQuery END | query="${query}" | total=${(t2 - t0).toFixed(1)}ms | Sites=${
        response.Sites.length
      } Docs=${response.Documents.length} Contacts=${response.Contacts.length}`,
    )
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
