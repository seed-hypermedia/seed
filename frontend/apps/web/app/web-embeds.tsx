import {injectModels} from '@/models'
import {useNavigate} from '@remix-run/react'
import {
  createWebHMUrl,
  formattedDate,
  getMetadataName,
  HMAccountsMetadata,
  HMBlockQuery,
  HMDocumentInfo,
  HMEmbedView,
  hmId,
  hmIdPathToEntityQueryPath,
  narrowHmId,
  queryBlockSortedItems,
  UnpackedHypermediaId,
  useUniversalAppContext,
} from '@shm/shared'
import {EntityComponentProps} from '@shm/shared/document-content-types'
import {useResource, useResources} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {
  ContentEmbed,
  DocumentCardGrid,
  ErrorBlock,
  InlineEmbedButton,
  useDocContentContext,
} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {DocumentCard} from '@shm/ui/newspaper'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {useMemo, useState} from 'react'

injectModels()

function EmbedWrapper({
  id,
  hideBorder = false,
  children,
}: React.PropsWithChildren<{
  id: UnpackedHypermediaId
  parentBlockId: string | null
  hideBorder?: boolean
  embedView?: HMEmbedView
}>) {
  const docContext = useDocContentContext()
  const {originHomeId} = useUniversalAppContext()
  const navigate = useNavigate()

  return (
    <div
      className={cn(
        'w-full',
        hideBorder && 'border-primary border-[3px] border-l',
      )}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const selection = window.getSelection()
        const hasSelection = selection && selection.toString().length > 0
        if (hasSelection) {
          return
        }
        const destUrl = createWebHMUrl(id.uid, {
          hostname: null,
          blockRange: id.blockRange,
          blockRef: id.blockRef,
          version: id.version,
          latest: id.latest,
          path: id.path,
          originHomeId,
        })
        if (e.nativeEvent.metaKey) {
          window.open(destUrl, '_blank')
        } else {
          navigate(destUrl)
        }
      }}
      onMouseEnter={() => docContext?.onHoverIn?.(id)}
      onMouseLeave={() => docContext?.onHoverOut?.(id)}
    >
      {children}
    </div>
  )
}

export function EmbedDocument(props: EntityComponentProps) {
  if (props.block.type !== 'Embed') return null
  if (props.block.attributes?.view == 'Card') {
    return <EmbedDocumentCard {...props} />
  } else {
    return <EmbedDocumentContent {...props} />
  }
}

export function EmbedComment(props: EntityComponentProps) {
  // return <DocInlineEmbed {...props} />
  return <SizableText>Comment</SizableText>
}

export function EmbedInline(props: EntityComponentProps) {
  const {onHoverIn, onHoverOut} = useDocContentContext()
  return (
    <DocInlineEmbed {...props} onHoverIn={onHoverIn} onHoverOut={onHoverOut} />
  )
}

function DocInlineEmbed(props: EntityComponentProps) {
  const doc = useResource(props)
  const document = doc.data?.type === 'document' ? doc.data.document : undefined
  const ctx = useDocContentContext()
  const {supportDocuments, supportQueries} = ctx || {}
  const entity = props.id
    ? supportDocuments?.find((d) => d.id.id === props.id)
    : null
  const renderDocument = document || entity?.document
  // basiclly we are willing to get the document from either ajax request or supportDocuments
  // supportDocuments is there for initial load, while the ajax will have up-to-date info
  return (
    <InlineEmbedButton
      entityId={narrowHmId(props)}
      block={props.block}
      parentBlockId={props.parentBlockId}
      depth={props.depth}
      onHoverIn={props.onHoverIn}
      onHoverOut={props.onHoverOut}
    >
      {`@${getMetadataName(renderDocument?.metadata) || '...'}`}
    </InlineEmbedButton>
  )
}

export function EmbedDocumentCard(props: EntityComponentProps) {
  const doc = useResource(props)
  const document = doc.data?.type === 'document' ? doc.data.document : undefined
  const authors = useResources(document?.authors.map((uid) => hmId(uid)) || [])
  if (doc.isLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  if (!doc.data) return <ErrorBlock message="Could not load embed" />
  const id = narrowHmId(props)
  return (
    <EmbedWrapper id={id} parentBlockId={props.parentBlockId} hideBorder>
      <DocumentCard
        isWeb
        entity={{
          id,
          document: document,
        }}
        docId={id}
        accountsMetadata={Object.fromEntries(
          authors
            .map((d) => d.data)
            .filter((d) => !!d)
            .map((authorDoc) => [
              authorDoc.id.uid,
              {
                id: authorDoc.id,
                metadata:
                  authorDoc.type === 'document'
                    ? authorDoc.document?.metadata
                    : undefined,
              },
            ])
            .filter(([_, metadata]) => !!metadata),
        )}
      />
    </EmbedWrapper>
  )
}

export function EmbedDocumentContent(props: EntityComponentProps) {
  const [showReferenced, setShowReferenced] = useState(false)
  const doc = useResource(props)
  const document = doc.data?.type === 'document' ? doc.data.document : undefined
  const {entityId} = useDocContentContext()
  if (props.id && entityId && props.id === entityId.id) {
    return (
      // avoid recursive embeds!
      <SizableText color="muted">Embed: Parent document (skipped)</SizableText>
    )
  }
  // return <div>{JSON.stringify(doc.data)}</div>;
  return (
    <ContentEmbed
      props={props}
      isLoading={doc.isLoading}
      showReferenced={showReferenced}
      onShowReferenced={setShowReferenced}
      document={document}
      EmbedWrapper={EmbedWrapper}
      parentBlockId={props.parentBlockId}
      renderOpenButton={
        () => null
        //   <Button
        //     size="$2"
        //     icon={ArrowUpRightSquare}
        //     onPress={() => {
        //       if (!props.id) return
        //       navigate({
        //         key: 'document',
        //         id: props,
        //       })
        //     }}
        //   >
        //     Open Document
        //   </Button>
      }
    />
  )
}

export function QueryBlockWeb({
  id,
  block,
}: {
  id: UnpackedHypermediaId
  block: HMBlockQuery
}) {
  const ctx = useDocContentContext()
  // const query
  const {supportQueries, supportDocuments} = ctx || {}
  const includes = block.attributes.query.includes || []
  if (includes.length == 0) return null
  const queryInclude = includes[0]
  if (!queryInclude || includes.length !== 1)
    return (
      <ErrorBlock message="Only one QueryBlock.attributes.query.includes is supported for now" />
    )
  if (!queryInclude.space) return <ErrorBlock message="Empty Query" />

  const queryResults = supportQueries?.find((q) => {
    if (q.in.uid !== queryInclude.space) return false
    const path = hmIdPathToEntityQueryPath(q.in.path)

    let comparePath =
      queryInclude.path?.[0] === '/'
        ? queryInclude.path
        : queryInclude.path
        ? `/${queryInclude.path}`
        : ''
    if (path !== comparePath) return false
    if (q.mode !== queryInclude.mode) return false
    return true
  })

  // const sorted = sortQueryBlockResults(queryResults, block.attributes.query.sort);
  // queryResults?.results.map(resu)
  // return queryResults?.results

  let sortedItems = queryBlockSortedItems({
    entries: queryResults?.results || [],
    sort: block.attributes.query.sort || [{term: 'UpdateTime', reverse: false}],
  })

  if (block.attributes.query.limit) {
    sortedItems = sortedItems.slice(0, block.attributes.query.limit)
  }

  const DataComponent =
    block.attributes.style == 'List' ? QueryListStyle : QueryStyleCard

  return <DataComponent block={block} items={sortedItems} />
}

function QueryStyleCard({
  block,
  items,
}: {
  block: HMBlockQuery
  items: Array<HMDocumentInfo>
}) {
  const ctx = useDocContentContext()
  const {supportDocuments} = ctx || {}

  function getEntity(path: string[]) {
    return supportDocuments?.find(
      (entity) => entity?.id?.path?.join('/') === path?.join('/'),
    )
  }

  const accountsMetadata =
    ctx.supportDocuments?.reduce((acc, d) => {
      if (!d.document?.metadata) return acc
      if (d.id.path?.length) return acc
      acc[d.id.uid] = {
        id: d.id,
        metadata: d.document.metadata,
      }
      return acc
    }, {} as HMAccountsMetadata) || {}

  const docs = useMemo(() => {
    return items.map((item) => {
      const id = hmId(item.account, {
        path: item.path,
        latest: true,
      })
      return {id, item}
    })
  }, [items])

  const firstItem = block.attributes.banner ? docs[0] : null
  const restItems = block.attributes.banner ? docs.slice(1) : docs

  return (
    <DocumentCardGrid
      firstItem={firstItem}
      items={restItems}
      getEntity={getEntity}
      accountsMetadata={accountsMetadata}
      columnCount={block.attributes.columnCount}
    />
  )
}

function QueryListStyle({
  block,
  items,
}: {
  block: HMBlockQuery
  items: Array<HMDocumentInfo>
}) {
  const navigate = useNavigate()

  return (
    <div className="flex w-full flex-col gap-3">
      {items?.map((item) => {
        const id = hmId(item.account, {
          path: item.path,
          latest: true,
        })
        const icon =
          id.path?.length == 0 || item.metadata?.icon ? (
            <HMIcon size={28} id={id} metadata={item.metadata} />
          ) : null
        return (
          <Button
            className="h-15 h-auto shadow-md"
            variant="outline"
            onClick={() => {
              navigate(
                createWebHMUrl(id.uid, {
                  hostname: null,
                  blockRange: id.blockRange,
                  blockRef: id.blockRef,
                  version: id.version,
                  latest: id.latest,
                  path: id.path,
                }),
              )
            }}
          >
            {icon}
            <div className="flex flex-1 items-center gap-2 overflow-hidden py-2">
              <SizableText weight="bold" className="truncate">
                {item.metadata.name}
              </SizableText>
            </div>
            <SizableText size="xs" color="muted">
              {formattedDate(item.updateTime)}
            </SizableText>
          </Button>
        )
      })}
    </div>
  )
}
