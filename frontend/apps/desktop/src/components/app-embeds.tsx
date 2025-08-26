import {useSelectedAccountContacts} from '@/models/contacts'
import {useListDirectory} from '@/models/documents'
import {useAccountsMetadata, useSubscribedResource} from '@/models/entities'
import {LibraryData} from '@/models/library'
import {getContactMetadata, queryBlockSortedItems} from '@shm/shared/content'
import {EntityComponentProps} from '@shm/shared/document-content-types'
import {
  HMAccountsMetadata,
  HMBlockQuery,
  HMComment,
  HMDocument,
  HMDocumentInfo,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useResources} from '@shm/shared/models/entity'
import {DocumentRoute} from '@shm/shared/routes'
import {formattedDate} from '@shm/shared/utils/date'
import {hmId, narrowHmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
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
import {
  BlankQueryBlockMessage,
  QueryBlockPlaceholder,
} from '@shm/ui/entity-card'
import {HMIcon} from '@shm/ui/hm-icon'
import {ArrowUpRightSquare} from '@shm/ui/icons'
import {DocumentCard} from '@shm/ui/newspaper'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {
  HTMLAttributes,
  PropsWithChildren,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {useNavigate} from '../utils/useNavigate'

function EmbedWrapper({
  id,
  parentBlockId,
  children,
  depth,
  viewType = 'Content',
  hideBorder = false,
  isRange = false,
  embedView,
  ...props
}: PropsWithChildren<
  {
    id?: UnpackedHypermediaId
    parentBlockId: string | null
    depth?: number
    viewType?: 'Content' | 'Card'
    hideBorder?: boolean
    isRange?: boolean
    embedView?: any
  } & Omit<HTMLAttributes<HTMLDivElement>, 'id'>
>) {
  const docContentContext = useDocContentContext()

  const {comment, routeParams} = docContentContext
  const spawn = useNavigate('spawn')
  const replace = useNavigate('replace')
  const navigate = useNavigate()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const sideannotationRef = useRef<HTMLDivElement>(null)
  const wrapperRect = useRef<DOMRect>()
  const sideRect = useRef<DOMRect>()
  const [sidePos, setSidePos] = useState<'bottom' | 'right'>('bottom')
  const [isHighlight, setHighlight] = useState(false)
  const route = useNavRoute()

  const isSameDocument = useMemo(() => {
    if (!id) return false
    if (route.key !== 'document') return false
    return (
      typeof id.id == 'string' &&
      typeof route?.id?.id == 'string' &&
      id.id == route?.id?.id
    )
  }, [route, id])

  useEffect(() => {
    const val =
      (routeParams?.uid == id?.uid &&
        routeParams?.version == id?.version &&
        comment) ||
      false

    if (val) {
      setTimeout(() => {
        setHighlight(false)
      }, 1000)
    }

    setHighlight(val)
  }, [routeParams?.uid, routeParams?.version, comment, id?.id, id?.version])

  useEffect(() => {
    if (wrapperRef.current) {
      observeSize(wrapperRef.current, (rect) => {
        wrapperRect.current = rect
      })
    }
    if (sideannotationRef.current) {
      observeSize(sideannotationRef.current, (rect) => {
        sideRect.current = rect
      })
    }

    function onWindowResize() {
      if (wrapperRect.current && sideRect.current) {
        const targetSize = sideRect.current.width + 48
        setSidePos(
          targetSize < window.innerWidth - wrapperRect.current.right
            ? 'right'
            : 'bottom',
        )
      }
    }

    window.addEventListener('resize', onWindowResize, false)
    setTimeout(() => {
      onWindowResize()
    }, 500)

    return () => {
      window.removeEventListener('resize', onWindowResize, false)
    }
  }, [wrapperRef])

  return id ? (
    <div
      ref={wrapperRef}
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
      // this data attribute is used by the hypermedia highlight component
      onMouseEnter={() => {
        docContentContext?.onHoverIn?.(id)
      }}
      onMouseLeave={() => {
        docContentContext?.onHoverOut?.(id)
      }}
      data-blockid={
        id &&
        id.blockRange &&
        'expanded' in id.blockRange &&
        id.blockRange.expanded
          ? id?.blockRef
          : undefined
      }
      data-docid={id?.blockRef ? undefined : id?.id}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const selection = window.getSelection()
        const hasSelection = selection && selection.toString().length > 0
        if (hasSelection) {
          return
        }

        if (route.key != 'document') {
          return
        }
        // if the embed is from the same document, we replace the current route, if not, we navigate forward
        const defaultMethod = isSameDocument ? replace : navigate
        // if the user is holding the meta key, we always spawn a new window
        const method = e.nativeEvent.metaKey ? spawn : defaultMethod

        const destRoute = isSameDocument
          ? ({
              ...route,
              id: {
                ...(route as DocumentRoute).id,
                blockRef: id.blockRef,
                blockRange:
                  id.blockRange &&
                  'start' in id.blockRange &&
                  'end' in id.blockRange
                    ? id.blockRange
                    : null,
                expanded:
                  id.blockRange &&
                  'expanded' in id.blockRange &&
                  id.blockRange.expanded
                    ? id.blockRange.expanded
                    : false,
              },
            } as DocumentRoute)
          : ({
              key: 'document',
              id: {
                ...id,
                blockRef: id.blockRef,
                blockRange:
                  id.blockRange &&
                  'start' in id.blockRange &&
                  'end' in id.blockRange
                    ? id.blockRange
                    : null,
                expanded:
                  id.blockRange &&
                  'expanded' in id.blockRange &&
                  id.blockRange.expanded
                    ? id.blockRange.expanded
                    : false,
              },
            } as DocumentRoute)
        method(destRoute)
      }}
      {...props}
    >
      {children}
    </div>
  ) : null
}

export function observeSize(
  element: HTMLElement,
  callback: (r: DOMRect) => void,
) {
  const ro = new ResizeObserver(() => {
    const r = element.getBoundingClientRect()
    callback(r)
  })
  ro.observe(element)
  return () => ro.disconnect()
}

export function useSizeObserver(onRect: (rect: DOMRect) => void) {
  const widthObserver = useRef<null | (() => void)>(null)
  return (el: HTMLElement | null) => {
    if (!el) return
    widthObserver.current?.()
    widthObserver.current = observeSize(el, onRect)
  }
}

export function EmbedDocument(props: EntityComponentProps) {
  if (props.block.type !== 'Embed') {
    return <BlockContentUnknown {...props} />
  }
  if (props.block.attributes?.view == 'Card') {
    return <EmbedDocumentCard {...props} />
  } else {
    return <EmbedDocumentContent {...props} />
  }
}

export function EmbedDocumentContent(props: EntityComponentProps) {
  const {entityId} = useDocContentContext()
  if (props.id && entityId && props.id === entityId.id) {
    return (
      // avoid recursive embeds!
      <SizableText color="muted" className="text-[length:var(--text-unit)]">
        Embed: Parent document (skipped)
      </SizableText>
    )
  }
  const resource = useSubscribedResource(props)
  {
  }
  // @ts-ignore
  if (resource.data?.type === 'document') {
    return (
      <DocumentContentEmbed
        {...props}
        // @ts-ignore
        document={resource.data.document}
        // @ts-ignore
        isLoading={resource.isInitialLoading}
      />
    )
    {
    }
    // @ts-ignore
  } else if (resource.data?.type === 'comment') {
    return (
      <CommentEmbed
        {...props}
        // @ts-ignore
        comment={resource.data.comment}
        // @ts-ignore
        isLoading={resource.isInitialLoading}
      />
    )
  } else return <BlockContentUnknown {...props} />
}

function DocumentContentEmbed(
  props: EntityComponentProps & {document: HMDocument; isLoading: boolean},
) {
  const {document, isLoading} = props
  const navigate = useNavigate()
  const [showReferenced, setShowReferenced] = useState(false)

  const route = useNavRoute()

  return (
    <ContentEmbed
      props={props}
      isLoading={isLoading}
      showReferenced={showReferenced}
      onShowReferenced={setShowReferenced}
      document={document}
      EmbedWrapper={EmbedWrapper}
      parentBlockId={props.parentBlockId}
      renderOpenButton={() => (
        <Button
          size="sm"
          onClick={(e) => {
            if (route.key != 'document') {
              e.preventDefault()
              e.stopPropagation()
              return
            }
            if (!props.id) return
            navigate({
              key: 'document',
              id: props,
            })
          }}
        >
          <ArrowUpRightSquare className="mr-2" />
          Open Document
        </Button>
      )}
    />
  )
}

function CommentEmbed(
  props: EntityComponentProps & {comment: HMComment; isLoading: boolean},
) {
  const {comment, isLoading} = props
  const route = useNavRoute()
  const navigate = useNavigate()
  const [showReferenced, setShowReferenced] = useState(false)
  const authorId = comment?.author ? hmId(comment?.author) : null
  const author = useSubscribedResource(authorId)
  return (
    <EmbedWrapper
      viewType="Content"
      depth={props.depth}
      id={narrowHmId(props)}
      parentBlockId={props.parentBlockId || ''}
    >
      <CommentContentEmbed
        props={props}
        comment={comment}
        EmbedWrapper={EmbedWrapper}
        isLoading={isLoading}
        // @ts-expect-error
        author={author.data}
      />
    </EmbedWrapper>
  )
}

export function EmbedDocumentCard(props: EntityComponentProps) {
  const route = useNavRoute()
  const doc = useSubscribedResource(props)
  const authors = useAccountsMetadata(
    // @ts-ignore
    doc.data?.type === 'document' ? doc.data.document?.authors || [] : [],
  )
  const view =
    (props.block.type === 'Embed' ? props.block.attributes.view : undefined) ||
    'Content'
  {
  }
  // @ts-ignore
  if (doc.isLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  {
  }
  {
    /* @ts-ignore */
  }
  if (!doc.data) return <ErrorBlock message="Could not load embed" />
  const id = narrowHmId(props)
  return (
    <EmbedWrapper
      hideBorder
      id={id}
      parentBlockId={props.parentBlockId}
      viewType={view}
    >
      <div className="flex p-3">
        <DocumentCard
          entity={{
            id,
            document:
              // @ts-ignore
              doc.data.type === 'document' ? doc.data.document : undefined,
          }}
          docId={id}
          accountsMetadata={authors}
          navigate={route.key === 'document'}
        />
      </div>
    </EmbedWrapper>
  )
}

export function EmbedInline(props: EntityComponentProps) {
  const {onHoverIn, onHoverOut} = useDocContentContext()
  return (
    <DocInlineEmbed {...props} onHoverIn={onHoverIn} onHoverOut={onHoverOut} />
  )
}

function DocInlineEmbed(props: EntityComponentProps) {
  const contacts = useSelectedAccountContacts()
  const doc = useSubscribedResource(props)
  {
  }
  // @ts-ignore
  const document = doc.data?.type === 'document' ? doc.data.document : undefined
  return (
    <InlineEmbedButton
      entityId={narrowHmId(props)}
      block={props.block}
      parentBlockId={props.parentBlockId}
      depth={props.depth}
      onHoverIn={props.onHoverIn}
      onHoverOut={props.onHoverOut}
      style={props.style}
    >
      {getContactMetadata(props.uid, document?.metadata, contacts.data).name ||
        '?'}
    </InlineEmbedButton>
  )
}

export function QueryBlockDesktop({
  block,
  id,
}: {
  block: HMBlockQuery
  id: UnpackedHypermediaId
}) {
  useSubscribedResource(id, true)

  const directoryItems = useListDirectory(id, {
    // @ts-ignore
    mode: block.attributes.query.includes[0].mode,
  })

  const sortedItems = useMemo(() => {
    let items: Array<HMDocumentInfo> = []

    if (directoryItems.data && block.attributes.query.sort) {
      let sorted = queryBlockSortedItems({
        entries: directoryItems.data || [],
        sort: block.attributes.query.sort,
      })

      items = sorted
    }

    if (block.attributes.query.limit) {
      items = items.slice(0, block.attributes.query.limit)
    }

    return items
  }, [
    directoryItems,
    block.attributes.query.sort,
    block.attributes.query.limit,
  ])

  const docIds =
    sortedItems.map((item) =>
      hmId(item.account, {
        path: item.path,
        latest: true,
      }),
    ) || []

  const authorIds = new Set<string>()
  sortedItems.forEach((item) =>
    item.authors.forEach((authorId) => authorIds.add(authorId)),
  )

  const documents = useResources([
    ...docIds,
    ...Array.from(authorIds).map((uid) => hmId(uid)),
  ])

  function getEntity(path: string[]) {
    return (
      documents?.find(
        (document) => document.data?.id?.path?.join('/') === path?.join('/'),
      )?.data || null
    )
  }

  const accountsMetadata: HMAccountsMetadata = Object.fromEntries(
    documents
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

  if (directoryItems.isInitialLoading) {
    return (
      <div className="block-query flex w-full" data-content-type="query">
        <QueryBlockPlaceholder styleType={block.attributes?.style} />
      </div>
    )
  }

  const DataComponent =
    block.attributes.style == 'List' ? QueryStyleList : QueryStyleCard

  return (
    <DataComponent
      items={sortedItems}
      block={block}
      getEntity={getEntity}
      accountsMetadata={accountsMetadata}
    />
  )
}

function QueryStyleCard({
  items,
  block,
  getEntity,
  accountsMetadata,
}: {
  items: any[]
  block: HMBlockQuery
  getEntity: any
  accountsMetadata: HMAccountsMetadata
}) {
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
      // @ts-ignore
      firstItem={firstItem}
      items={restItems}
      getEntity={getEntity}
      accountsMetadata={accountsMetadata}
      columnCount={block.attributes.columnCount}
    />
  )
}

function QueryStyleList({items}: {items: any[]}) {
  const navigate = useNavigate()

  const entries = useMemo(
    () =>
      items.map((item) => {
        const id = hmId(item.account, {
          path: item.path,
          latest: true,
        })

        return {
          id,
          document: item,
          location: [],
          authors: [],
          account: item.account,
          path: item.path,
          isFavorite: false,
          isSubscribed: false,
        } as LibraryData['items'][0]
      }),
    [items],
  )

  return (
    <div className="flex w-full flex-col gap-3">
      {entries.length ? (
        entries.map((item) => {
          return (
            <Button
              className="h-15 h-auto shadow-md"
              variant="outline"
              onClick={() => {
                navigate({
                  key: 'document',
                  id: item.id,
                })
              }}
            >
              <HMIcon
                size={28}
                id={item.id}
                metadata={item.document?.metadata}
              />
              <div className="flex flex-1 items-center gap-2 overflow-hidden py-2">
                <SizableText weight="bold" className="truncate">
                  {item.document?.metadata.name}
                </SizableText>
              </div>
              <SizableText size="xs" color="muted">
                {formattedDate(item.document?.updateTime)}
              </SizableText>
            </Button>
          )
        })
      ) : (
        <BlankQueryBlockMessage message="No Documents found in this Query Block." />
      )}
    </div>
  )
}
