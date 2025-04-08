import {useEffect, useRef} from 'react'
import {useRecents} from './recents'
import {searchQuery, SearchResultItem} from './search'

export function useInlineMentions() {
  const recents = useRecents()
  const recentsRef = useRef<InlineSearchItem[]>([])
  useEffect(() => {
    recentsRef.current =
      recents.data?.map((recent) => ({
        title: recent.name,
        subtitle: '',
        value: recent.id.id,
      })) ?? []
  }, [recents])

  async function onMentionsQuery(query: string) {
    if (!searchQuery) throw new Error('searchQuery not injected')
    const resp = await searchQuery(query)
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
      Recents: recentsRef.current,
    }
    if (!entities.length) return emptyRespose
    const response = entities.reduce((acc: InlineMentionsResult, entity) => {
      if (entity.id?.path?.length) {
        acc.Documents.push({
          title: entity.title,
          subtitle: 'Document',
          value: entity.id.id,
        })
      } else {
        acc.Sites.push({
          title: entity.title,
          subtitle: 'Site',
          value: entity.id.id,
        })
      }
      return acc
    }, emptyRespose)
    return response
  }

  return {
    onMentionsQuery,
  }
}

export type InlineSearchItem = {
  title: string
  subtitle: string
  value: string
}

export type InlineMentionsResult = {
  Sites: Array<InlineSearchItem>
  Documents: Array<InlineSearchItem>
  Recents: Array<InlineSearchItem>
}
