import {
  BlockRange,
  HMBlockEmbed,
  HMBlockNode,
  HMComment,
  HMDocument,
  HMEmbedView,
  HMResolvedResource,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {formattedDateMedium, getCommentTargetId, getDocumentTitle, unpackHmId, useUniversalClient} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavigate} from '@shm/shared/utils/navigation'
import {AlertCircle, Undo2} from 'lucide-react'
import React, {ReactNode, useCallback, useMemo, useState} from 'react'
import {toast} from 'sonner'
import type {HMResource} from '@seed-hypermedia/client/hm-types'
import type {BlockContentProps} from './blocks-content'
import {BlockNodeContent, BlockNodeList, BlocksContentProvider, useContentResourceId} from './blocks-content'
import {getBlockNodeById} from './blocks-content-utils'
import {Button} from './button'
import {CommentContent, Discussions} from './comments'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'
import {EmbedWrapper} from './embed-wrapper'
import {HMIcon} from './hm-icon'
import {DocumentNameLink} from './inline-descriptor'
import {DocumentCard} from './newspaper'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {Tooltip} from './tooltip'

/** Displays an error message with optional debug data toggle. */
export function ErrorBlock({
  message,
  debugData,
  children,
}: {
  message: string
  debugData?: any
  children?: React.ReactNode
}) {
  let [open, toggleOpen] = useState(false)
  return (
    <Tooltip content={debugData ? (open ? 'Hide debug Data' : 'Show debug data') : ''}>
      <div className="block-content block-unknown flex flex-1 flex-col">
        <div
          className="flex-start flex items-center gap-2 overflow-hidden rounded-md border border-red-300 bg-red-100 p-2"
          onClick={(e) => {
            e.stopPropagation()
            toggleOpen((v) => !v)
          }}
        >
          <SizableText color="destructive" className="font-sans text-sm">
            {message ? message : 'Error'}
          </SizableText>
          <AlertCircle color="danger" className="size-3" />
          {children}
        </div>
        {open ? (
          <pre className="border-border rounded-md border bg-gray-100 p-2 dark:bg-gray-800">
            <code className="font-mono text-xs wrap-break-word">{JSON.stringify(debugData, null, 4)}</code>
          </pre>
        ) : null}
      </div>
    </Tooltip>
  )
}

/** Warning banner for embeds whose content has been deleted. Shows a toggle when content is available. */
export function DeletedEmbedBanner({children, entityLabel = 'document'}: {children?: ReactNode; entityLabel?: string}) {
  const [showContent, setShowContent] = useState(false)
  const hasContent = !!children
  return (
    <div className="block-content flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-100 p-2 dark:border-amber-600 dark:bg-amber-900/30">
        <AlertCircle className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
        <SizableText className="flex-1 text-sm text-amber-800 dark:text-amber-200">
          This embedded {entityLabel} has been deleted
        </SizableText>
        {hasContent ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              setShowContent((v) => !v)
            }}
          >
            {showContent ? 'Hide content' : 'Show content'}
          </Button>
        ) : null}
      </div>
      {showContent && hasContent ? children : null}
    </div>
  )
}

/** Renders an embedded document as a card view. */
export function BlockEmbedCard({
  block,
  parentBlockId,
  openOnClick = true,
}: BlockContentProps<HMBlockEmbed> & {openOnClick?: boolean}) {
  const id = unpackHmId(block.link) ?? undefined
  const doc = useResource(id, {subscribed: true})
  // Check tombstone on latest version for version-pinned embeds.
  // Version-specific fetches skip the backend's tombstone check.
  const latestCheckId = id?.version && !id?.latest ? hmId(id.uid, {path: id.path}) : undefined
  const latestCheck = useResource(latestCheckId)
  const document = doc.data?.type === 'document' ? doc.data.document : undefined
  const authors = useResources(document?.authors.map((uid: string) => hmId(uid)) || [])
  const isDeleted =
    doc.isTombstone ||
    doc.data?.type === 'tombstone' ||
    latestCheck.data?.type === 'tombstone' ||
    latestCheck.isTombstone
  if (doc.isInitialLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  // No content available at all — banner without toggle
  if (doc.data?.type === 'tombstone') {
    return <DeletedEmbedBanner />
  }
  if (doc.data?.type === 'not-found') {
    if (doc.isDiscovering) {
      return (
        <div className="flex items-center justify-center gap-2 p-4">
          <Spinner className="size-4" />
          <SizableText className="text-muted-foreground">Looking for this content...</SizableText>
        </div>
      )
    }
    return <ErrorBlock message="Could not load embed" />
  }
  if (doc.data?.type === 'error') {
    return <ErrorBlock message={doc.data.message} />
  }
  if (doc.isError || !doc.data) return <ErrorBlock message="Could not load embed" />

  const accountsMetadata = Object.fromEntries(
    authors
      .map((d: any) => d.data)
      .filter((d: any) => !!d)
      .map((authorDoc: any) => [
        authorDoc.id.uid,
        {
          id: authorDoc.id,
          metadata: authorDoc.type === 'document' ? authorDoc.document?.metadata : undefined,
        },
      ])
      .filter(([_, metadata]) => !!metadata),
  )

  if (!id) return <ErrorBlock message="Invalid Embed URL" />

  const card = (
    <EmbedWrapper
      id={id}
      parentBlockId={parentBlockId}
      hideBorder
      route={{key: 'document', id}}
      openOnClick={openOnClick}
    >
      <DocumentCard
        entity={{
          id,
          document: document,
        }}
        docId={id}
        accountsMetadata={accountsMetadata}
        navigate={false}
      />
    </EmbedWrapper>
  )

  if (isDeleted) {
    return <DeletedEmbedBanner>{card}</DeletedEmbedBanner>
  }

  return card
}

/** Renders full embedded document or comment content. */
export function BlockEmbedContent({
  block,
  depth,
  parentBlockId,
  openOnClick = true,
  renderDocumentContent,
}: BlockContentProps<HMBlockEmbed> & {
  openOnClick?: boolean
  renderDocumentContent?: (props: {
    embedBlocks: HMBlockNode[]
    document: HMDocument | null | undefined
    id: UnpackedHypermediaId
  }) => React.ReactNode
}) {
  const resourceId = useContentResourceId()
  const [showReferenced, setShowReferenced] = useState(false)
  const id = unpackHmId(block.link)

  const isSelfEmbed =
    id && resourceId && resourceId.uid === id.uid && resourceId.path?.join('/') === id.path?.join('/') && id.latest

  const resource = useResource(id, {subscribed: true})
  // Check tombstone on latest version for version-pinned embeds.
  // Version-specific fetches skip the backend's tombstone check.
  const latestCheckId = id?.version && !id?.latest ? hmId(id.uid, {path: id.path}) : null
  const latestCheck = useResource(latestCheckId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const comment = resource.data?.type === 'comment' ? resource.data.comment : undefined
  const commentTargetResource = useResource(getCommentTargetId(comment))

  const author = useResource(comment?.author ? hmId(comment?.author) : null)

  const isDeleted =
    resource.isTombstone ||
    resource.data?.type === 'tombstone' ||
    latestCheck.data?.type === 'tombstone' ||
    latestCheck.isTombstone

  if (isSelfEmbed) {
    // this avoids a dangerous recursive embedding of the same document
    return <ErrorBlock message="Cannot embed the latest version of a document within itself" />
  }
  if (!id) return <ErrorBlock message="Invalid embed link" />
  // No content available at all — banner without toggle
  if (resource.data?.type === 'tombstone') {
    return <DeletedEmbedBanner />
  }
  if (resource.data?.type === 'not-found') {
    if (resource.isDiscovering) {
      return (
        <div className="block-content border-border bg-muted/30 flex items-center gap-2 rounded-md border p-4">
          <Spinner className="size-4" />
          <SizableText className="text-muted-foreground">Looking for this content...</SizableText>
        </div>
      )
    }
    return (
      <ErrorBlock message="Resource not found">
        <Button
          variant="destructive"
          onClick={() => {
            copyUrlToClipboardWithFeedback(block.link, 'Missing Resource')
          }}
        >
          Copy Link
        </Button>
      </ErrorBlock>
    )
  }
  if (resource.data?.type === 'error') {
    return <ErrorBlock message={resource.data.message} />
  }
  if (resource.isError || (!resource.isLoading && !resource.data)) {
    return <ErrorBlock message="Could not load embed" />
  }
  if (comment) {
    // Detect stale version for version-pinned comment embeds
    const latestComment = latestCheck.data?.type === 'comment' ? latestCheck.data.comment : undefined
    const isStaleCommentVersion = !!(latestComment && comment.version !== latestComment.version)

    const commentContent = (
      <BlockEmbedContentComment
        parentBlockId={parentBlockId}
        depth={depth}
        block={block}
        id={id}
        comment={comment}
        isLoading={resource.isLoading}
        targetResource={commentTargetResource.data ?? undefined}
        author={author.data?.type === 'document' || author.data?.type === 'comment' ? author.data : undefined}
        openOnClick={openOnClick}
        isStaleVersion={isStaleCommentVersion}
      />
    )
    if (isDeleted) {
      return <DeletedEmbedBanner entityLabel="comment">{commentContent}</DeletedEmbedBanner>
    }
    return commentContent
  }

  const embedContent = (
    <BlockEmbedContentDocument
      id={id}
      depth={depth}
      viewType={block.attributes?.view}
      blockId={block.id}
      blockRef={id.blockRef}
      blockRange={id.blockRange}
      isLoading={resource.isLoading}
      showReferenced={showReferenced}
      onShowReferenced={setShowReferenced}
      document={document}
      parentBlockId={parentBlockId}
      renderOpenButton={() => null}
      openOnClick={openOnClick}
      renderDocumentContent={renderDocumentContent}
    />
  )

  if (isDeleted) {
    return <DeletedEmbedBanner>{embedContent}</DeletedEmbedBanner>
  }

  return embedContent
}

/** Renders embedded comments section for a document. */
export function BlockEmbedComments({
  parentBlockId,
  block,
  openOnClick = true,
}: BlockContentProps<HMBlockEmbed> & {openOnClick?: boolean}) {
  const client = useUniversalClient()
  const id = unpackHmId(block.link)

  const resource = useResource(id, {
    recursive: true,
    subscribed: true,
  })
  // Check tombstone on latest version for version-pinned embeds.
  const latestCheckId = id?.version && !id?.latest ? hmId(id.uid, {path: id.path}) : null
  const latestCheck = useResource(latestCheckId)

  if (!id) {
    return <ErrorBlock message="Invalid embed link" />
  }
  // No content available at all — banner without toggle
  if (resource.data?.type === 'tombstone') {
    return <DeletedEmbedBanner />
  }

  const isDeleted = resource.isTombstone || latestCheck.data?.type === 'tombstone' || latestCheck.isTombstone
  const CommentEditor = client.CommentEditor

  const content = (
    <EmbedWrapper id={id} parentBlockId={parentBlockId} hideBorder openOnClick={openOnClick}>
      {CommentEditor ? (
        <div
          onClick={(e) => {
            e.stopPropagation()
          }}
        >
          <CommentEditor docId={id} />
        </div>
      ) : null}
      <Discussions targetId={id} />
    </EmbedWrapper>
  )

  if (isDeleted) {
    return <DeletedEmbedBanner>{content}</DeletedEmbedBanner>
  }

  return content
}

/** Info banner for version-pinned comment embeds whose content has changed since embedding. */
export function BlockEmbedContentComment({
  id,
  parentBlockId,
  depth,
  comment,
  author,
  block,
  targetResource,
  openOnClick = true,
  isStaleVersion = false,
}: {
  id: UnpackedHypermediaId
  parentBlockId: string | null
  depth: number | undefined
  block: HMBlockEmbed
  isLoading?: boolean
  comment: HMComment
  author: HMResolvedResource | null | undefined
  targetResource: HMResource | undefined
  openOnClick?: boolean
  isStaleVersion?: boolean
}) {
  return (
    <EmbedWrapper
      viewType={block.attributes?.view}
      depth={depth || 0}
      id={id}
      parentBlockId={parentBlockId || ''}
      openOnClick={openOnClick}
      route={{
        key: 'document',
        id: getCommentTargetId(comment)!,
        panel: {
          key: 'comments',
          id,
          openComment: comment.id,
        },
      }}
    >
      {author && (
        <CommentEmbedHeader
          comment={comment}
          author={author}
          targetResource={targetResource}
          isStaleVersion={isStaleVersion}
        />
      )}
      <CommentContent comment={comment} zoomBlockRef={id.blockRef} allowHighlight={false} openOnClick={openOnClick} />
    </EmbedWrapper>
  )
}

/** Header for embedded comment showing author info and target document link. */
function CommentEmbedHeader({
  comment,
  author,
  targetResource,
  isStaleVersion = false,
}: {
  comment: HMComment
  author: HMResolvedResource
  targetResource: HMResource | undefined
  isStaleVersion?: boolean
}) {
  const authorMetadata = author.type === 'document' ? author.document?.metadata : undefined
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap justify-between p-3">
        <div className="flex items-center gap-2">
          {author.id && <HMIcon size={24} id={author.id} name={authorMetadata?.name} icon={authorMetadata?.icon} />}
          <SizableText weight="bold">{authorMetadata?.name || '?'}</SizableText>
          {targetResource && targetResource.type === 'document' ? (
            <>
              {' on '}
              <DocumentNameLink metadata={targetResource.document?.metadata} id={targetResource.id} />
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          {comment.createTime ? (
            <SizableText size="sm" color="muted">
              {formattedDateMedium(comment.createTime)}
            </SizableText>
          ) : null}
          {JSON.stringify(comment.createTime) !== JSON.stringify(comment.updateTime) ? (
            <SizableText size="xs" className="text-muted-foreground">
              (edited)
            </SizableText>
          ) : null}
        </div>
      </div>
      {isStaleVersion ? (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 dark:border-blue-600 dark:bg-blue-900/30">
          <AlertCircle className="size-3 shrink-0 text-blue-600 dark:text-blue-400" />
          <SizableText size="xs" className="text-blue-800 dark:text-blue-200">
            This is an older version — the comment has been edited since it was embedded
          </SizableText>
        </div>
      ) : null}
    </div>
  )
}

/** Internal component rendering embedded document content with block ref/range support. */
function BlockEmbedContentDocument(props: {
  depth: number | undefined
  blockId: string
  blockRef: string | null
  blockRange: BlockRange | null
  isLoading: boolean
  id: UnpackedHypermediaId
  document: HMDocument | null | undefined
  showReferenced: boolean
  onShowReferenced: (showReference: boolean) => void
  renderOpenButton: () => React.ReactNode
  parentBlockId: string | null
  viewType?: HMEmbedView
  openOnClick?: boolean
  renderDocumentContent?: (props: {
    embedBlocks: HMBlockNode[]
    document: HMDocument | null | undefined
    id: UnpackedHypermediaId
  }) => React.ReactNode
}) {
  const {
    id,
    blockId,
    isLoading,
    document,
    showReferenced,
    onShowReferenced,
    renderOpenButton,
    parentBlockId,
    viewType,
    openOnClick,
  } = props
  const navigate = useNavigate()

  const embedData = useMemo(() => {
    const selectedBlock =
      props.blockRef && document?.content ? getBlockNodeById(document.content, props.blockRef) : null

    // @ts-expect-error
    const currentAnnotations = selectedBlock?.block?.annotations || []
    const embedBlocks = props.blockRef
      ? selectedBlock
        ? [
            {
              ...selectedBlock,
              block: {
                ...selectedBlock.block,
                annotations:
                  props.blockRange && 'start' in props.blockRange
                    ? [
                        ...currentAnnotations,
                        {
                          type: 'Range',
                          starts: [props.blockRange.start],
                          ends: [props.blockRange.end],
                        },
                      ]
                    : currentAnnotations,
              },
              children:
                props.blockRange && 'expanded' in props.blockRange && props.blockRange.expanded
                  ? [...(selectedBlock.children || [])]
                  : [],
            },
          ]
        : null
      : document?.content
    let res = {
      ...document,
      data: {
        document,
        embedBlocks,
        blockRange:
          props.blockRange && 'start' in props.blockRange && selectedBlock
            ? {
                blockId: props.blockRef,
                start: props.blockRange.start,
                end: props.blockRange.end,
              }
            : null,
      },
    }
    return res
  }, [props.blockRef, props.blockRange, document])

  const embedOnBlockSelect = useCallback(
    (blockId: string, opts?: BlockRange & {copyToClipboard?: boolean}): boolean => {
      if (!openOnClick) return false
      if (opts?.copyToClipboard) {
        toast.error('Error: not implemented')
        return false
      }
      navigate({
        key: 'document',
        id: {
          ...id,
          blockRef: blockId || null,
        },
      })
      return true
    },
    [navigate, id],
  )

  let content: null | JSX.Element = <ErrorBlock message="Unknown error" />
  if (isLoading) {
    content = <Spinner />
  } else if (embedData.data.embedBlocks) {
    if (props.renderDocumentContent) {
      content = (
        <>
          {props.renderDocumentContent({
            embedBlocks: embedData.data.embedBlocks as HMBlockNode[],
            document,
            id,
          })}
        </>
      )
    } else {
      content = (
        <BlocksContentProvider onBlockSelect={embedOnBlockSelect} resourceId={id}>
          <BlockNodeList childrenType="Group">
            {!props.blockRef && document?.metadata?.name ? (
              <BlockNodeContent
                parentBlockId={props.parentBlockId}
                isFirstChild
                depth={props.depth}
                embedId={blockId}
                allowHighlight={false}
                blockNode={{
                  block: {
                    type: 'Heading',
                    id: blockId,
                    text: getDocumentTitle(document) || '',
                    attributes: {
                      childrenType: 'Group',
                    },
                    annotations: [],
                  },
                  children: embedData.data.embedBlocks as Array<HMBlockNode>,
                }}
                childrenType="Group"
                index={0}
                embedDepth={1}
              />
            ) : (
              embedData.data.embedBlocks.map((bn, idx) => (
                // @ts-expect-error
                <BlockNodeContent
                  key={bn.block?.id}
                  isFirstChild={!props.blockRef && document?.metadata?.name ? true : idx == 0}
                  depth={1}
                  embedId={blockId}
                  allowHighlight={false}
                  blockNode={bn}
                  childrenType="Group"
                  index={idx}
                  embedDepth={1}
                />
              ))
            )}
          </BlockNodeList>

          {showReferenced ? (
            <div className="flex justify-end">
              <Tooltip content="The latest reference was not found. Click to try again.">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    onShowReferenced(false)
                  }}
                >
                  <Undo2 className="size-3" />
                  Back to Reference
                </Button>
              </Tooltip>
            </div>
          ) : null}
        </BlocksContentProvider>
      )
    }
  } else if (props.blockRef) {
    return (
      <ErrorBlock message={`Block #${props.blockRef} was not found in this version`}>
        <div className="flex gap-2 p-4">
          {id.version ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onShowReferenced(true)
              }}
            >
              Show Referenced Version
            </Button>
          ) : null}
          {renderOpenButton()}
        </div>
      </ErrorBlock>
    )
  }
  return (
    <EmbedWrapper
      route={{key: 'document', id}}
      viewType={viewType}
      depth={props.depth || 1}
      id={id}
      parentBlockId={parentBlockId || ''}
      isRange={!!props.blockRange && ('start' in props.blockRange || 'end' in props.blockRange)}
      openOnClick={openOnClick}
    >
      {content}
    </EmbedWrapper>
  )
}
