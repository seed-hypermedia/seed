import {searchQuery, SearchResultItem} from './search'

// function useRecents() {
//   return useQuery({
//     queryKey: ['recents'],
//     queryFn: () => {
//       return []
//     },
//   })
// }

export function useInlineMentions() {
  // const recents = useRecents()
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
      Recents: [],
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
