import {useAccount_deprecated} from '@/models/accounts'
import {useListDirectory} from '@/models/documents'
import {useEntities, useSubscribedEntity} from '@/models/entities'
import {LibraryData} from '@/models/library'
import {LibraryListItem} from '@/pages/library'
import {
  DAEMON_FILE_URL,
  HMBlockQuery,
  UnpackedHypermediaId,
  formattedDateMedium,
  getDocumentTitle,
  hmId,
  narrowHmId,
  packHmId,
  queryBlockSortedItems,
} from '@shm/shared'
import {
  ArrowUpRightSquare,
  BannerNewspaperCard,
  BlockContentUnknown,
  BlockNodeContent,
  BlockNodeList,
  Button,
  ContentEmbed,
  EntityComponentProps,
  ErrorBlock,
  HMIcon,
  InlineEmbedButton,
  NewspaperCard,
  QueryBlockPlaceholder,
  SizableText,
  UIAvatar,
  XStack,
  YStack,
  YStackProps,
  blockStyles,
  getBlockNodeById,
  useDocContentContext,
} from '@shm/ui'
import {AccountsMetadata} from '@shm/ui/src/face-pile'
import {Spinner} from '@shm/ui/src/spinner'
import {
  ComponentProps,
  PropsWithChildren,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {useComment} from '../models/comments'
import {useNavigate} from '../utils/useNavigate'

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
  const {
    disableEmbedClick = false,
    comment,
    routeParams,
  } = useDocContentContext()
  const navigate = useNavigate('push')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const sideannotationRef = useRef<HTMLDivElement>(null)
  const wrapperRect = useRef<DOMRect>()
  const sideRect = useRef<DOMRect>()
  const [sidePos, setSidePos] = useState<'bottom' | 'right'>('bottom')
  const [isHighlight, setHighlight] = useState(false)

  useEffect(() => {
    const val =
      (routeParams?.documentId == id?.id &&
        routeParams?.version == id?.version &&
        comment) ||
      false

    if (val) {
      setTimeout(() => {
        setHighlight(false)
      }, 1000)
    }

    setHighlight(val)
  }, [
    routeParams?.documentId,
    routeParams?.version,
    comment,
    id?.id,
    id?.version,
  ])

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

  return (
    <YStack
      ref={wrapperRef}
      contentEditable={false}
      userSelect="none"
      {...blockStyles}
      className="block-embed"
      data-content-type="embed"
      data-url={id ? packHmId(id) : ''}
      data-view={viewType}
      backgroundColor={
        isHighlight
          ? routeParams?.blockRef == id?.blockRef
            ? '$yellow3'
            : '$backgroundTransparent'
          : '$backgroundTransparent'
      }
      hoverStyle={{
        backgroundColor: isHighlight
          ? routeParams?.blockRef == id?.blockRef
            ? '$brand11'
            : '$backgroundTransparent'
          : '$backgroundTransparent',
        // borderRadius: '$2',
        // borderRightColor: depth == 1 ? '$blue7' : undefined,
      }}
      margin={0}
      // marginHorizontal={-1 * layoutUnit}

      // padding={layoutUnit / 2}
      // overflow="hidden"
      borderRadius={0}
      borderRightWidth={hideBorder ? 0 : 3}
      borderRightColor={hideBorder ? '$colorTransparent' : '$brand8'}
      // borderLeftWidth={6}
      // borderLeftColor={isHighlight ? '$yellow6' : '$color4'}
      onPress={
        !disableEmbedClick
          ? () => {
              if (!id) return
              navigate({
                key: 'document',
                id,
              })
            }
          : undefined
      }
      {...props}
    >
      {children}
      {/* {!comment && viewType == 'Content' ? (
        <EmbedSideAnnotation
          sidePos={sidePos}
          ref={sideannotationRef}
          id={hmRef}
          disableEmbedClick={disableEmbedClick}
        />
      ) : null} */}
    </YStack>
  )
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
  const {entityId} = useDocContentContext()
  if (props.id && entityId && props.id === entityId.id) {
    return (
      // avoid recursive embeds!
      <SizableText color="$color9">
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
          onPress={() => {
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
  const doc = useSubscribedEntity(props)
  const authors = useEntities(
    doc.data?.document?.authors?.map((uid) => hmId('d', uid)) || [],
  )
  const view =
    (props.block.type === 'Embed' ? props.block.attributes.view : undefined) ||
    'Content'
  if (doc.isLoading) return <Spinner />
  if (!doc.data) return <ErrorBlock message="Could not load embed" />
  const id = narrowHmId(props)
  return (
    <EmbedWrapper
      hideBorder
      id={id}
      parentBlockId={props.parentBlockId}
      viewType={view}
    >
      <NewspaperCard
        entity={{
          id,
          document: doc.data.document,
        }}
        id={id}
        accountsMetadata={authors
          .map((author) => author.data)
          .filter((d) => !!d)}
      />
    </EmbedWrapper>
  )
}

export function EmbedComment(props: EntityComponentProps) {
  if (props?.type !== 'comment')
    throw new Error('Invalid props as ref for EmbedComment')
  const comment = useComment(hmId('comment', props.uid), {
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
  const account = useAccount_deprecated(comment.data?.author)
  if (comment.isLoading) return null
  return (
    <EmbedWrapper id={narrowHmId(props)} parentBlockId={props.parentBlockId}>
      <XStack flexWrap="wrap" jc="space-between" p="$3">
        <XStack gap="$2">
          <UIAvatar
            label={account.data?.profile?.alias}
            id={account.data?.id}
            url={
              account.data?.profile?.avatar
                ? `${DAEMON_FILE_URL}/${account.data?.profile?.avatar}`
                : undefined
            }
          />
          <SizableText>{account.data?.profile?.alias}</SizableText>
        </XStack>
        {comment.data?.createTime ? (
          <SizableText fontSize="$2" color="$color10">
            {formattedDateMedium(comment.data.createTime)}
          </SizableText>
        ) : null}
      </XStack>
      {embedBlocks?.length ? (
        <BlockNodeList childrenType="group">
          {embedBlocks.map((bn, idx) => (
            <BlockNodeContent
              isFirstChild={idx === 0}
              key={bn.block?.id}
              depth={1}
              blockNode={bn}
              childrenType="group"
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

function IconComponent({accountId}: {accountId?: string}) {
  const id = accountId ? hmId('d', accountId) : undefined
  const entity = useSubscribedEntity(id)
  if (!id) return null
  return <HMIcon id={id} metadata={entity.data?.document?.metadata} size={28} />
}

export function EmbedInline(props: UnpackedHypermediaId) {
  if (props?.type == 'd') {
    return <DocInlineEmbed {...props} />
  } else {
    console.error('Inline Embed Error', JSON.stringify(props))
    return <SizableText>??</SizableText>
  }
}

function DocInlineEmbed(props: UnpackedHypermediaId) {
  const pubId = props?.type == 'd' ? props.id : undefined
  if (!pubId) throw new Error('Invalid props at DocInlineEmbed (pubId)')
  const doc = useSubscribedEntity(props)
  return (
    <InlineEmbedButton id={props}>
      @{getDocumentTitle(doc.data?.document)}
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
    if (directoryItems.data && block.attributes.query.sort) {
      return queryBlockSortedItems({
        entries: directoryItems.data || [],
        sort: block.attributes.query.sort,
      })
    }
    return []
  }, [block.attributes.query.sort, directoryItems])

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
    return documents?.find(
      (document) => document.data?.id?.path?.join('/') === path?.join('/'),
    )?.data
  }

  const accountsMetadata: AccountsMetadata = documents
    .map((document) => {
      const d = document.data
      if (!d || !d.document) return null
      if (d.id.path && d.id.path.length !== 0) return null
      return {
        id: d.id,
        metadata: d.document.metadata,
      }
    })
    .filter((m) => !!m)

  if (directoryItems.status == 'loading') {
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
  accountsMetadata: any
}) {
  const columnProps = useMemo(() => {
    switch (block.attributes.columnCount) {
      case 2:
        return {
          flexBasis: '100%',
          $gtSm: {flexBasis: '50%'},
          $gtMd: {flexBasis: '50%'},
        } as YStackProps
      case 3:
        return {
          flexBasis: '100%',
          $gtSm: {flexBasis: '50%'},
          $gtMd: {flexBasis: '33.333%'},
        } as YStackProps
      default:
        return {
          flexBasis: '100%',
          $gtSm: {flexBasis: '100%'},
          $gtMd: {flexBasis: '100%'},
        } as YStackProps
    }
  }, [block.attributes.columnCount])

  const firstItem = block.attributes.banner ? items[0] : null
  const restItems = block.attributes.banner ? items.slice(1) : items

  return (
    <YStack width="100%">
      {firstItem ? (
        <BannerNewspaperCard
          item={firstItem}
          entity={getEntity(firstItem.path)}
          key={firstItem.path.join('/')}
          accountsMetadata={accountsMetadata}
        />
      ) : null}
      {restItems?.length ? (
        <XStack
          f={1}
          flexWrap="wrap"
          marginHorizontal="$-3"
          justifyContent="center"
        >
          {restItems.map((item) => {
            const id = hmId('d', item.account, {
              path: item.path,
              latest: true,
            })
            return (
              <YStack {...columnProps} p="$3">
                <NewspaperCard
                  id={id}
                  entity={getEntity(item.path)}
                  key={item.path.join('/')}
                  accountsMetadata={accountsMetadata}
                  flexBasis="100%"
                  $gtSm={{flexBasis: '100%'}}
                  $gtMd={{flexBasis: '100%'}}
                />
              </YStack>
            )
          })}
        </XStack>
      ) : (
        <QueryBlockPlaceholder styleType={block.attributes.style} />
      )}
    </YStack>
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
          hasDraft: false,
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
          const id = hmId('d', item.account, {
            path: item.path,
            latest: true,
          })
          return (
            <LibraryListItem
              key={item.id}
              entry={item}
              exportMode={false}
              selected={false}
              toggleDocumentSelection={(id) => {}}
            />
          )
        })
      ) : (
        <QueryBlockPlaceholder styleType={block.attributes.style} />
      )}
    </YStack>
  )
}
