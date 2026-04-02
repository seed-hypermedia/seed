import {HMAccountsMetadata, HMBlockQuery, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryBlockSortedItems} from '@shm/shared/content'
import {useDirectory, useResource, useResources} from '@shm/shared/models/entity'
import {useInteractionSummaries} from '@shm/shared/models/interaction-summary'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {QueryBlockContent} from '@shm/ui/query-block-content'
import {Fragment} from '@tiptap/pm/model'
import {useMemo, useState} from 'react'
import {Block, BlockNoteEditor} from './blocknote'
import {createReactBlockSpec} from './blocknote/react'
import {HMBlockSchema} from './schema'

const defaultQueryIncludes = '[{"space":"","path":"","mode":"Children"}]'
const defaultQuerySort = '[{"term":"UpdateTime","reverse":false}]'

export const QueryBlock = createReactBlockSpec({
  type: 'query',
  propSchema: {
    style: {
      values: ['Card', 'List'],
      default: 'Card',
    },
    columnCount: {
      default: '3',
      values: ['1', '2', '3'],
    },
    queryLimit: {
      default: '',
    },
    queryIncludes: {
      default: defaultQueryIncludes,
    },
    querySort: {
      default: defaultQuerySort,
    },
    banner: {
      default: 'false',
      values: ['true', 'false'],
    },
    defaultOpen: {
      default: 'false',
      values: ['true', 'false'],
    },
  },
  containsInlineContent: true,

  render: ({block, editor}: {block: Block<HMBlockSchema>; editor: BlockNoteEditor<HMBlockSchema>}) =>
    Render(block, editor),

  parseHTML: [
    {
      tag: 'div[data-content-type=query]',
      priority: 1000,
      getContent: (_node, _schema) => {
        return Fragment.empty
      },
    },
  ],
})

type HMQueryBlockIncludes = HMBlockQuery['attributes']['query']['includes']

function Render(block: Block<HMBlockSchema>, _editor: BlockNoteEditor<HMBlockSchema>) {
  const queryIncludes: HMQueryBlockIncludes = useMemo(() => {
    return JSON.parse(block.props.queryIncludes || defaultQueryIncludes)
  }, [block.props.queryIncludes])

  const querySort = useMemo(() => {
    return JSON.parse(block.props.querySort || defaultQuerySort)
  }, [block.props.querySort])

  const banner = block.props.banner === 'true'

  const [queryId] = useState<UnpackedHypermediaId | null>(() => {
    if (queryIncludes?.[0]?.space) {
      return hmId(queryIncludes[0].space, {
        path: queryIncludes[0].path ? queryIncludes[0].path.split('/') : null,
        latest: true,
      })
    }
    return null
  })

  const mode = queryIncludes[0]?.mode || 'Children'
  const entity = useResource(queryId, {
    enabled: !!queryId,
    subscribed: true,
    recursive: mode === 'AllDescendants',
  })
  const directoryItems = useDirectory(queryId, {mode})

  const sortedItems = useMemo(() => {
    if (directoryItems.data && querySort) {
      const sorted = queryBlockSortedItems({
        entries: directoryItems.data,
        sort: querySort,
      })
      const queryLimit = parseInt(block.props.queryLimit || '', 10)
      return sorted.slice(0, queryLimit > 0 ? queryLimit : undefined)
    }
    return []
  }, [directoryItems, querySort, block.props.queryLimit])

  // Batch-fetch interaction summaries
  const summaryIds = useMemo(() => sortedItems.map((item) => hmId(item.id.uid, {path: item.id.path})), [sortedItems])
  const interactionSummaries = useInteractionSummaries(summaryIds)

  // Collect author UIDs and build per-item contributors map
  const {allAuthorIds, itemContributors} = useMemo(() => {
    const allIds = new Set<string>()
    const contributors: Record<string, string[]> = {}
    sortedItems.forEach((item, idx) => {
      const uids = new Set(item.authors)
      item.authors.forEach((uid) => allIds.add(uid))
      const summaryUids = interactionSummaries[idx]?.data?.authorUids
      summaryUids?.forEach((uid) => {
        uids.add(uid)
        allIds.add(uid)
      })
      contributors[item.id.id] = Array.from(uids)
    })
    return {allAuthorIds: Array.from(allIds), itemContributors: contributors}
  }, [sortedItems, interactionSummaries])

  const authors = useResources(allAuthorIds.map((uid) => hmId(uid)))

  const accountsMetadata: HMAccountsMetadata = Object.fromEntries(
    authors
      .map((document) => {
        const d = document.data
        if (!d || d.type !== 'document') return null
        if (d.id.path && d.id.path.length !== 0) return null
        return [
          d.id.uid,
          {
            id: d.id,
            metadata: d.document.metadata,
          },
        ]
      })
      .filter((m) => !!m),
  )

  const documents = useResources(sortedItems.map((item) => item.id))

  function getEntity(id: UnpackedHypermediaId) {
    return documents?.find((document) => document.data?.id?.id === id.id)?.data || null
  }

  return (
    <div contentEditable={false} className="-mx-4 flex flex-col px-4 select-none">
      <QueryBlockContent
        items={sortedItems}
        style={block.props.style as 'Card' | 'List'}
        columnCount={block.props.columnCount}
        banner={banner}
        accountsMetadata={accountsMetadata}
        itemContributors={itemContributors}
        getEntity={getEntity}
        isDiscovering={entity.isDiscovering || directoryItems.isLoading}
      />
    </div>
  )
}
