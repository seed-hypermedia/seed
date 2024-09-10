import {useAccount_deprecated} from '@/models/accounts'
import {useEntities, useEntity} from '@/models/entities'
import {
  DAEMON_FILE_URL,
  UnpackedHypermediaId,
  formattedDateMedium,
  getAccountName,
  getDocumentTitle,
  hmId,
  packHmId,
  unpackHmId,
} from '@shm/shared'
import {
  BlockContentUnknown,
  BlockNodeContent,
  BlockNodeList,
  Button,
  ContentEmbed,
  DocumentCardView,
  EntityComponentProps,
  InlineEmbedButton,
  SizableText,
  Spinner,
  Thumbnail,
  UIAvatar,
  XStack,
  YStack,
  blockStyles,
  getBlockNodeById,
  useDocContentContext,
} from '@shm/ui'
import {ArrowUpRightSquare} from '@tamagui/lucide-icons'
import {
  ComponentProps,
  PropsWithChildren,
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {SizableTextProps, YStackProps} from 'tamagui'
import {useComment} from '../models/comments'
import {useNavigate} from '../utils/useNavigate'
import {EntityLinkThumbnail} from './account-link-thumbnail'

function EmbedWrapper({
  id,
  parentBlockId,
  children,
  depth,
  viewType = 'content',
  ...props
}: PropsWithChildren<
  {
    id?: UnpackedHypermediaId
    parentBlockId: string | null
    depth?: number
    viewType?: 'content' | 'card'
  } & Omit<ComponentProps<typeof YStack>, 'id'>
>) {
  const {
    disableEmbedClick = false,
    comment,
    routeParams,
  } = useDocContentContext()
  const navigate = useNavigate('replace')
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
        cursor: 'pointer',
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
      borderRightWidth={3}
      borderRightColor={'$brand8'}
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
      {/* {!comment && viewType == 'content' ? (
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

const EmbedSideAnnotation = forwardRef<
  HTMLDivElement,
  {id: string; sidePos: 'bottom' | 'right'; disableEmbedClick?: boolean}
>(function EmbedSideAnnotation({id, sidePos, disableEmbedClick}, ref) {
  const unpacked = unpackHmId(id)

  const sideStyles: YStackProps =
    sidePos == 'right'
      ? {
          position: 'absolute',
          top: 32,
          right: -16,
          transform: 'translateX(100%)',
        }
      : {}

  if (unpacked && unpacked.type == 'comment')
    return (
      <CommentSideAnnotation
        ref={ref}
        unpackedRef={unpacked}
        sideStyles={sideStyles}
      />
    )
  if (unpacked && unpacked.type != 'd') return null
  const entity = useEntity(unpacked)
  const editors = useEntities(
    entity.data?.document?.authors.map((accountId) => hmId('d', accountId)) ||
      [],
  )
  return (
    <YStack
      ref={ref}
      p="$2"
      flex="none"
      className="embed-side-annotation"
      width="max-content"
      maxWidth={300}
      group="item"
      {...sideStyles}
    >
      <SizableText size="$1" fontWeight="600">
        {getDocumentTitle(entity?.data?.document)}
      </SizableText>
      <SizableText size="$1" color="$color9">
        {formattedDateMedium(entity.data?.document?.updateTime)}
      </SizableText>
      <XStack
        marginHorizontal="$2"
        gap="$2"
        ai="center"
        paddingVertical="$1"
        alignSelf="flex-start"
      >
        <XStack ai="center">
          {editors
            .map((editor) => editor.data)
            .filter(Boolean)
            .map(
              (editorAccount, idx) =>
                editorAccount?.id && (
                  <XStack
                    zIndex={idx + 1}
                    key={editorAccount?.id.id}
                    borderColor="$background"
                    backgroundColor="$background"
                    borderWidth={2}
                    borderRadius={100}
                    marginLeft={-8}
                  >
                    <EntityLinkThumbnail id={editorAccount?.id} />
                  </XStack>
                ),
            )}
        </XStack>
      </XStack>
      {disableEmbedClick ? null : (
        <SizableText
          size="$1"
          color="$brand5"
          opacity={0}
          $group-item-hover={{opacity: 1}}
        >
          Go to Document →
        </SizableText>
      )}
    </YStack>
  )
})

const CommentSideAnnotation = forwardRef(function CommentSideAnnotation(
  props: {unpackedRef?: UnpackedHypermediaId; sideStyles: YStackProps},
  ref,
) {
  const comment = useComment(props.unpackedRef)

  const unpackedTarget = useMemo(() => {
    if (comment && comment.data?.target) {
      return unpackHmId(comment.data.target)
    } else {
      return null
    }
  }, [comment])

  const pubTarget = useEntity(unpackedTarget)

  const editors =
    pubTarget.data?.document?.authors.map((accountId) =>
      hmId('d', accountId),
    ) || []

  if (pubTarget.status == 'success') {
    return (
      <YStack
        ref={ref}
        p="$2"
        flex="none"
        className="embed-side-annotation"
        width="max-content"
        maxWidth={300}
        group="item"
        {...props.sideStyles}
      >
        {/* <XStack ai="center" gap="$2" bg="green"> */}
        <SizableText size="$1">
          comment on{' '}
          <SizableText size="$1" fontWeight="600">
            {getDocumentTitle(pubTarget?.data?.document)}
          </SizableText>
        </SizableText>
        {/* <SizableText fontSize={12} color="$color9">
            {formattedDateMedium(pub.data?.document?.publishTime)}
          </SizableText> */}
        {/* </XStack> */}
        <SizableText size="$1" color="$color9">
          {formattedDateMedium(pubTarget.data?.document?.updateTime)}
        </SizableText>
        <XStack
          marginHorizontal="$2"
          gap="$2"
          ai="center"
          paddingVertical="$1"
          alignSelf="flex-start"
        >
          <XStack ai="center">
            {editors.map(
              (editorId, idx) =>
                editorId?.id && (
                  <XStack
                    zIndex={idx + 1}
                    key={editorId?.id}
                    borderColor="$background"
                    backgroundColor="$background"
                    borderWidth={2}
                    borderRadius={100}
                    marginLeft={-8}
                  >
                    <EntityLinkThumbnail id={editorId} />
                  </XStack>
                ),
            )}
          </XStack>
        </XStack>
        <SizableText
          size="$1"
          color="$brand5"
          opacity={0}
          $group-item-hover={{opacity: 1}}
        >
          Go to Comment →
        </SizableText>
      </YStack>
    )
  }

  return null
})

export function EmbedDocument(props: EntityComponentProps) {
  if (props.block.attributes?.view == 'card') {
    return <EmbedDocumentCard {...props} />
  } else {
    return <EmbedDocContent {...props} />
  }
}

export function EmbedDocContent(props: EntityComponentProps) {
  const [showReferenced, setShowReferenced] = useState(false)
  const doc = useEntity(props)
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
  const doc = useEntity(props)
  let textContent = useMemo(() => {
    if (doc.data?.document?.content) {
      let content = ''
      doc.data?.document?.content.forEach((bn) => {
        content += bn.block?.text + ' '
      })
      return content
    }
  }, [doc.data])

  return (
    <EmbedWrapper
      id={{
        type: props.type,
        id: props.id,
        uid: props.uid,
        path: props.path,
        blockRef: props.blockRef,
        blockRange: props.blockRange,
        hostname: props.hostname,
        scheme: props.scheme,
        version: props.version,
      }}
      parentBlockId={props.parentBlockId}
      viewType={props.block.attributes?.view == 'card' ? 'card' : 'content'}
    >
      <DocumentCardView
        title={getDocumentTitle(doc.data?.document)}
        textContent={textContent}
        editors={doc.data?.document?.authors || []}
        ThumbnailComponent={ThumbnailComponent}
        date={doc.data?.document?.updateTime}
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
  if (comment.isLoading) return <Spinner />
  return (
    <EmbedWrapper
      id={{
        type: props.type,
        id: props.id,
        uid: props.uid,
        path: props.path,
        blockRef: props.blockRef,
        blockRange: props.blockRange,
        hostname: props.hostname,
        scheme: props.scheme,
        version: props.version,
      }}
      parentBlockId={props.parentBlockId}
    >
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

function ThumbnailComponent({accountId}: {accountId?: string}) {
  const id = accountId ? hmId('d', accountId) : undefined
  const entity = useEntity(id)
  if (!id) return null
  return (
    <Thumbnail id={id} metadata={entity.data?.document?.metadata} size={28} />
  )
}

function NameComponent({
  accountId,
  ...props
}: SizableTextProps & {accountId?: string}) {
  const id = accountId ? hmId('d', accountId) : undefined
  const entity = useEntity(id)
  if (!id) return null
  return (
    <SizableText {...props}>
      {getAccountName(entity.data?.document)}
    </SizableText>
  )
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
  const doc = useEntity(props)
  return (
    <InlineEmbedButton id={props}>
      {getDocumentTitle(doc.data?.document)}
    </InlineEmbedButton>
  )
}
