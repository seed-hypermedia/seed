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
import {useEntities, useEntity} from '@shm/shared/models/entity'
import {
  ContentEmbed,
  DocumentCardGrid,
  ErrorBlock,
  InlineEmbedButton,
  useDocContentContext,
} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {Button} from '@shm/ui/legacy/button'
import {DocumentCard} from '@shm/ui/newspaper'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {Text} from '@tamagui/core'
import {XStack, YStack} from '@tamagui/stacks'
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
    <YStack width="100%">
      <YStack
        width="100%"
        borderRadius={0}
        borderLeftWidth={hideBorder ? 0 : 3}
        borderLeftColor={hideBorder ? '$colorTransparent' : '$brand5'}
        onPress={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const destUrl = createWebHMUrl(id.type, id.uid, {
            hostname: null,
            blockRange: id.blockRange,
            blockRef: id.blockRef,
            version: id.version,
            latest: id.latest,
            path: id.path,
            originHomeId,
          })
          navigate(destUrl)
        }}
        onHoverIn={() => docContext?.onHoverIn?.(id)}
        onHoverOut={() => docContext?.onHoverOut?.(id)}
      >
        {children}
      </YStack>
    </YStack>
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
    return <Text>?</Text>
  }
}

function DocInlineEmbed(props: EntityComponentProps) {
  const pubId = props?.type == 'd' ? props.id : undefined
  if (!pubId) throw new Error('Invalid props at DocInlineEmbed (pubId)')
  const doc = useEntity(props)
  const document = doc.data?.document
  const ctx = useDocContentContext()
  const {supportDocuments, supportQueries} = ctx || {}
  const entity = pubId ? supportDocuments?.find((d) => d.id.id === pubId) : null
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
  const doc = useEntity(props)
  const authors = useEntities(
    doc.data?.document?.authors.map((uid) => hmId('d', uid)) || [],
  )
  if (doc.isLoading)
    return (
      <div className="flex justify-center items-center">
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
          document: doc.data.document,
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
                metadata: authorDoc.document?.metadata,
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
  const doc = useEntity(props)
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
      document={doc.data?.document}
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

  const columnClasses = useMemo(() => {
    return cn(
      'basis-full',
      block.attributes.columnCount == 2 && 'sm:basis-1/2',
      block.attributes.columnCount == 3 && 'sm:basis-1/2 md:basis-1/3',
    )
  }, [block.attributes.columnCount])

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
      columnClasses={columnClasses}
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
    <YStack gap="$3" w="100%">
      {items?.map((item) => {
        const id = hmId('d', item.account, {
          path: item.path,
          latest: true,
        })
        const icon =
          id.path?.length == 0 || item.metadata?.icon ? (
            <HMIcon size={28} id={id} metadata={item.metadata} />
          ) : null
        return (
          <Button
            borderWidth={0}
            backgroundColor="$colorTransparent"
            hoverStyle={{
              backgroundColor: '$color5',
            }}
            elevation="$1"
            paddingHorizontal={16}
            paddingVertical="$1"
            h={60}
            icon={icon}
            onPress={() => {
              navigate(
                createWebHMUrl(id.type, id.uid, {
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
            <XStack gap="$2" alignItems="center" flex={1} paddingVertical="$2">
              <SizableText
                weight="bold"
                className="overflow-hidden whitespace-nowrap text-ellipsis"
              >
                {item.metadata.name}
              </SizableText>
            </XStack>
            <SizableText size="xs" color="muted">
              {formattedDate(item.updateTime)}
            </SizableText>
          </Button>
        )
      })}
    </YStack>
  )
}
