import {useEffect, useRef} from 'react'
import {useRecents} from './recents'
import {searchQuery, SearchResultItem} from './search'

export function useInlineMentions(
  perspectiveAccountUid?: string | null | undefined,
) {
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
    const resp = await searchQuery(query, {
      perspectiveAccountUid: perspectiveAccountUid || undefined,
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
        acc.Contacts.push({
          title: entity.title,
          subtitle: 'Contact',
          value: entity.id.id,
        })
      } else if (entity.id?.path?.length) {
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
  Contacts: Array<InlineSearchItem>
}
