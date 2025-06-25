import {useSelectedAccountContacts} from '@/models/contacts'
import {useListDirectory} from '@/models/documents'
import {useSubscribedEntity} from '@/models/entities'
import {LibraryData} from '@/models/library'
import {useNavRoute} from '@/utils/navigation'
import {isMetaKeyPressed} from '@shm/shared'
import {getContactMetadata, queryBlockSortedItems} from '@shm/shared/content'
import {EntityComponentProps} from '@shm/shared/document-content-types'
import {
  HMAccountsMetadata,
  HMBlockQuery,
  HMDocumentInfo,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntities} from '@shm/shared/models/entity'
import {DocumentRoute} from '@shm/shared/routes'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {hmId, narrowHmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {
  BlockContentUnknown,
  BlockNodeContent,
  BlockNodeList,
  blockStyles,
  ContentEmbed,
  DocumentCardGrid,
  ErrorBlock,
  getBlockNodeById,
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
  ComponentProps,
  PropsWithChildren,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {Button, XStack, YStack} from 'tamagui'
import {useComment} from '../models/comments'
import {useNavigate} from '../utils/useNavigate'
import {LibraryListItem} from './list-item'

function EmbedWrapper({
  id,
  parentBlockId,
  children,
  depth,
  viewType = 'Content',
  hideBorder = false,
  ...props
}: PropsWithChildren<
  {
    id?: UnpackedHypermediaId
    parentBlockId: string | null
    depth?: number
    viewType?: 'Content' | 'Card'
    hideBorder?: boolean
  } & Omit<ComponentProps<typeof YStack>, 'id'>
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
      typeof id.uid == 'string' &&
      typeof route?.id?.uid == 'string' &&
      id.uid == route?.id?.uid
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
    <YStack
      ref={wrapperRef}
      // userSelect="none"
      // @ts-expect-error this is a tamagui error
      contentEditable={false}
      // userSelect="none"
      className={cn('block-embed', blockStyles)}
      data-content-type="embed"
      data-url={id ? packHmId(id) : ''}
      data-view={viewType}
      // this data attribute is used by the hypermedia highlight component
      onHoverIn={() => docContentContext?.onHoverIn?.(id)}
      onHoverOut={() => docContentContext?.onHoverOut?.(id)}
      data-blockid={id?.blockRef}
      data-docid={id?.blockRef ? undefined : id?.id}
      backgroundColor={
        isHighlight
          ? routeParams?.blockRef == id?.blockRef
            ? '$brand12'
            : '$backgroundTransparent'
          : '$backgroundTransparent'
      }
      hoverStyle={{
        backgroundColor: isHighlight
          ? routeParams?.blockRef == id?.blockRef
            ? '$brand12'
            : '$backgroundTransparent'
          : '$backgroundTransparent',
      }}
      margin={0}
      borderRadius={0}
      borderLeftWidth={hideBorder ? 0 : 3}
      borderLeftColor={hideBorder ? '$colorTransparent' : '$brand5'}
      onPress={(e) => {
        // Prevent navigation if there's text selected
        // const selection = window.getSelection()
        // if (selection && selection.toString().length > 0) {
        //   return
        // }

        const selection = window.getSelection()
        const hasSelection = selection && selection.toString().length > 0
        if (hasSelection) {
          e.preventDefault()
          e.stopPropagation()
          return
        }

        if (route.key != 'document') {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        // if the embed is from the same document, we navigate on the same window, if not. we open a new window.
        const defaultMethod = isMetaKeyPressed.get() ? spawn : navigate
        const method = isSameDocument ? replace : defaultMethod

        method(
          isSameDocument
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
                },
              } as DocumentRoute)
            : {
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
                },
              },
        )
      }}
      {...props}
    >
      {children}
    </YStack>
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
  if (props.block.attributes?.view == 'Card') {
    return <EmbedDocumentCard {...props} />
  } else {
    return <EmbedDocumentContent {...props} />
  }
}

export function EmbedDocumentContent(props: EntityComponentProps) {
  const [showReferenced, setShowReferenced] = useState(false)
  const {entityId, textUnit} = useDocContentContext()
  const route = useNavRoute()
  if (props.id && entityId && props.id === entityId.id) {
    return (
      // avoid recursive embeds!
      <SizableText color="muted" className="text-[length:var(--text-unit)]">
        Embed: Parent document (skipped)
      </SizableText>
    )
  }
  const doc = useSubscribedEntity(props)
  const navigate = useNavigate()
  return (
    <ContentEmbed
      props={props}
      isLoading={doc.isInitialLoading}
      showReferenced={showReferenced}
      onShowReferenced={setShowReferenced}
      document={doc.data?.document}
      EmbedWrapper={EmbedWrapper}
      parentBlockId={props.parentBlockId}
      renderOpenButton={() => (
        <Button
          size="$2"
          icon={ArrowUpRightSquare}
          onPress={(e) => {
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
          Open Document
        </Button>
      )}
    />
  )
}

export function EmbedDocumentCard(props: EntityComponentProps) {
  const route = useNavRoute()
  const doc = useSubscribedEntity(props)
  const authors = useEntities(
    doc.data?.document?.authors?.map((uid) => hmId('d', uid)) || [],
  )
  const view =
    (props.block.type === 'Embed' ? props.block.attributes.view : undefined) ||
    'Content'
  if (doc.isLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  if (!doc.data) return <ErrorBlock message="Could not load embed" />
  const id = narrowHmId(props)
  return (
    <EmbedWrapper
      hideBorder
      id={id}
      parentBlockId={props.parentBlockId}
      viewType={view}
    >
      <DocumentCard
        entity={{
          id,
          document: doc.data.document,
        }}
        docId={id}
        accountsMetadata={authors
          .map((author) => author.data)
          .filter((d) => !!d)}
        navigate={route.key === 'document'}
      />
    </EmbedWrapper>
  )
}

export function EmbedComment(props: EntityComponentProps) {
  if (props?.type !== 'c')
    throw new Error('Invalid props as ref for EmbedComment')
  const comment = useComment(hmId('c', props.uid), {
    enabled: !!props,
  })
  let embedBlocks = useMemo(() => {
    const selectedBlock =
      props.blockRef && comment.data?.content
        ? getBlockNodeById(comment.data.content, props.blockRef)
        : null

    const embedBlocks = selectedBlock ? [selectedBlock] : comment.data?.content

    return embedBlocks
  }, [props.blockRef, comment.data])
  const account = useSubscribedEntity(
    comment.data?.author ? hmId('d', comment.data?.author) : null,
  )
  if (comment.isLoading) return null
  return (
    <EmbedWrapper id={narrowHmId(props)} parentBlockId={props.parentBlockId}>
      <XStack flexWrap="wrap" jc="space-between" p="$3">
        <XStack gap="$2" ai="center">
          {account.data?.id && (
            <HMIcon
              size={24}
              id={account.data.id}
              metadata={account.data?.document?.metadata}
            />
          )}
          <SizableText weight="bold">
            {account.data?.document?.metadata?.name}
          </SizableText>
        </XStack>
        {comment.data?.createTime ? (
          <SizableText size="sm" color="muted">
            {formattedDateMedium(comment.data.createTime)}
          </SizableText>
        ) : null}
      </XStack>
      {embedBlocks?.length ? (
        <BlockNodeList childrenType="Group">
          {embedBlocks.map((bn, idx) => (
            <BlockNodeContent
              isFirstChild={idx === 0}
              key={bn.block?.id}
              depth={1}
              blockNode={bn}
              childrenType="Group"
              index={idx}
              embedDepth={1}
              parentBlockId={props.id}
            />
          ))}
        </BlockNodeList>
      ) : (
        <BlockContentUnknown {...props} />
      )}
    </EmbedWrapper>
  )
}

export function EmbedInline(props: EntityComponentProps) {
  const {onHoverIn, onHoverOut} = useDocContentContext()
  if (props?.type == 'd') {
    return (
      <DocInlineEmbed
        {...props}
        onHoverIn={onHoverIn}
        onHoverOut={onHoverOut}
      />
    )
  } else {
    console.error('Inline Embed Error', JSON.stringify(props))
    return <SizableText>??</SizableText>
  }
}

function DocInlineEmbed(props: EntityComponentProps) {
  const pubId = props?.type == 'd' ? props.id : undefined
  const contacts = useSelectedAccountContacts()
  if (!pubId) throw new Error('Invalid props at DocInlineEmbed (pubId)')
  const doc = useSubscribedEntity(props)
  const document = doc.data?.document
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
  useSubscribedEntity(id, true)

  const directoryItems = useListDirectory(id, {
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
      hmId('d', item.account, {
        path: item.path,
        latest: true,
      }),
    ) || []

  const authorIds = new Set<string>()
  sortedItems.forEach((item) =>
    item.authors.forEach((authorId) => authorIds.add(authorId)),
  )

  const documents = useEntities([
    ...docIds,
    ...Array.from(authorIds).map((uid) => hmId('d', uid)),
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
        if (!d || !d.document) return null
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
      <XStack className="block-query" w="100%" data-content-type="query">
        <QueryBlockPlaceholder styleType={block.attributes?.style} />
      </XStack>
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
      const id = hmId('d', item.account, {
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

function QueryStyleList({
  items,
  block,
  getEntity,
  accountsMetadata,
}: {
  items: any[]
  block: HMBlockQuery
  getEntity: any
  accountsMetadata: any
}) {
  const entries = useMemo(
    () =>
      items.map((item) => {
        const id = hmId('d', item.account, {
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
    <YStack gap="$3" w="100%">
      {entries.length ? (
        entries.map((item) => {
          return (
            <LibraryListItem
              key={item.id.id}
              docId={item.id.id}
              entry={item}
              exportMode={false}
              selected={false}
              toggleDocumentSelection={(id) => {}}
            />
          )
        })
      ) : (
        <BlankQueryBlockMessage message="No Documents found in this Query Block." />
      )}
    </YStack>
  )
}
