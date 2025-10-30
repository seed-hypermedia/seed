import {injectModels} from '@/models'
import {useNavigate} from '@remix-run/react'
import {
  createWebHMUrl,
  getMetadataName,
  HMAccountsMetadata,
  HMBlockQuery,
  HMDocumentInfo,
  HMEmbedView,
  hmId,
  hmIdPathToEntityQueryPath,
  narrowHmId,
  packHmId,
  queryBlockSortedItems,
  UnpackedHypermediaId,
  unpackHmId,
  useUniversalAppContext,
} from '@shm/shared'
import {EntityComponentProps} from '@shm/shared/document-content-types'
import {useResource, useResources} from '@shm/shared/models/entity'
import {Discussions} from '@shm/ui/comments'
import {
  BlockContentUnknown,
  blockStyles,
  CommentContentEmbed,
  ContentEmbed,
  DocumentCardGrid,
  ErrorBlock,
  InlineEmbedButton,
  useDocContentContext,
} from '@shm/ui/document-content'
import {QueryBlockContent} from '@shm/ui/query-block-content'
import {DocumentCard} from '@shm/ui/newspaper'
import {Spinner} from '@shm/ui/spinner'
import {cn} from '@shm/ui/utils'
import {useMemo, useRef, useState} from 'react'
import WebCommenting from './commenting'

injectModels()

function EmbedWrapper({
  id,
  hideBorder = false,
  viewType = 'Content',
  children,
  isRange = false,
  noClick = false,
}: React.PropsWithChildren<{
  id: UnpackedHypermediaId
  parentBlockId: string | null
  hideBorder?: boolean
  viewType?: 'Content' | 'Card'
  embedView?: HMEmbedView
  isRange?: boolean
  noClick?: boolean
}>) {
  const docContext = useDocContentContext()
  const {originHomeId} = useUniversalAppContext()
  const navigate = useNavigate()
  const wrapperRef = useRef<HTMLDivElement>(null)

  return (
    <div
      contentEditable={false}
      className={cn(
        'block-embed flex flex-col',
        blockStyles,
        // isHighlight
        //   ? routeParams?.blockRef == id?.blockRef
        //     ? 'bg-secondary'
        //     : 'bg-transparent'
        //   : 'bg-transparent hover:bg-transparent',
        !hideBorder && 'border-l-primary border-l-3',
        'm-0 rounded-none',
        isRange && 'hm-embed-range-wrapper',
      )}
      data-content-type="embed"
      data-url={id ? packHmId(id) : ''}
      data-view={viewType}
      data-blockid={
        id &&
        id.blockRange &&
        'expanded' in id.blockRange &&
        id.blockRange.expanded
          ? id?.blockRef
          : undefined
      }
      data-docid={id?.blockRef ? undefined : id?.id}
      onClick={
        noClick
          ? undefined
          : (e) => {
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
            }
      }
      onMouseEnter={() => docContext?.onHoverIn?.(id)}
      onMouseLeave={() => docContext?.onHoverOut?.(id)}
    >
      {children}
    </div>
  )
}

export function EmbedDocument(props: EntityComponentProps) {
  if (props.block.type !== 'Embed') {
    return <BlockContentUnknown {...props} />
  }
  if (props.block.attributes?.view == 'Card') {
    return <EmbedDocumentCard {...props} />
  } else if (props.block.attributes?.view == 'Comments') {
    return <EmbedDocumentComments {...props} />
  } else {
    return <EmbedDocumentContent {...props} />
  }
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
  const comment = doc.data?.type === 'comment' ? doc.data.comment : undefined

  const author = useResource(comment?.author ? hmId(comment?.author) : null)

  if (comment) {
    return (
      <CommentContentEmbed
        props={props}
        comment={comment}
        isLoading={doc.isLoading}
        // @ts-expect-error
        author={author.data}
        EmbedWrapper={EmbedWrapper}
      />
    )
  }
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
  const navigate = useNavigate()
  const {originHomeId} = useUniversalAppContext()

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

  return (
    <QueryBlockContent
      items={sortedItems}
      style={block.attributes.style || 'Card'}
      columnCount={block.attributes.columnCount}
      banner={block.attributes.banner || false}
      accountsMetadata={accountsMetadata}
      getEntity={getEntity}
      onDocumentClick={(id) => {
        navigate(
          createWebHMUrl(id.uid, {
            hostname: null,
            blockRange: id.blockRange,
            blockRef: id.blockRef,
            version: id.version,
            latest: id.latest,
            path: id.path,
            originHomeId,
          }),
        )
      }}
      isWeb={true}
    />
  )
}

function EmbedDocumentComments(props: EntityComponentProps) {
  const unpackedId = unpackHmId(
    props.block.type === 'Embed' ? props.block.link : undefined,
  )
  if (!unpackedId) {
    return <ErrorBlock message="Invalid embed link" />
  }

  try {
    return (
      <EmbedWrapper
        id={unpackedId}
        parentBlockId={props.parentBlockId}
        hideBorder
        noClick
      >
        <Discussions
          commentEditor={
            <div
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              <WebCommenting docId={unpackedId} />
            </div>
          }
          targetId={unpackedId}
        />
      </EmbedWrapper>
    )
  } catch (error) {
    console.error('Error rendering embedded comments:', error)
    return <ErrorBlock message="Failed to load comments" />
  }
}
