import {useDocumentCitations} from '@/models/citations'
import {useComment, useCommentReplies} from '@/models/comments'
import {useContactsMetadata} from '@/models/contacts'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {deduplicateCitations, hmId, unpackHmId} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMBlock,
  HMCitation,
  HMComment,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useResolvedResources, useResource} from '@shm/shared/models/entity'
import {DocumentDiscussionsAccessory} from '@shm/shared/routes'
import {AccessoryBackButton, AccessoryContent} from '@shm/ui/accessories'
import {DocumentCitationEntry} from '@shm/ui/citations'
import {Comment} from '@shm/ui/comments'
import {BlocksContent} from '@shm/ui/document-content'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {useMemo} from 'react'
import {renderCommentContent} from './commenting'

export function CitationsPanel({
  entityId,
  accessory,
  onAccessory,
}: {
  entityId?: UnpackedHypermediaId
  accessory: DocumentDiscussionsAccessory
  onAccessory: (accessory: DocumentDiscussionsAccessory) => void
}) {
  const citations = useDocumentCitations(entityId)
  if (!entityId) return null

  const distinctCitations = useMemo(() => {
    if (!citations.data) return []
    const filtered = citations.data.filter(
      (item) =>
        !accessory.openBlockId ||
        item.targetFragment?.blockId === accessory.openBlockId,
    )
    const deduped = deduplicateCitations(filtered)
    return deduped.filter((item) => item.source.type === 'd')
  }, [citations.data, accessory.openBlockId])

  const accountsToLoad = useMemo(() => {
    const accounts = new Set<string>()
    distinctCitations.forEach((citation) => {
      if (citation.source.author) {
        accounts.add(citation.source.author)
      }
    })
    return Array.from(accounts)
  }, [distinctCitations])

  const documentIds = useMemo(
    () =>
      distinctCitations
        .map((citation) =>
          citation.source.type === 'd' ? citation.source.id : null,
        )
        .filter(Boolean) as UnpackedHypermediaId[],
    [distinctCitations],
  )
  const documents = useResolvedResources(documentIds)
  const accounts = useContactsMetadata(accountsToLoad)
  return (
    <AccessoryContent>
      <div>
        {accessory.openBlockId ? (
          <AccessoryBackButton
            label="All Citations"
            onClick={() => onAccessory({...accessory, openBlockId: undefined})}
          />
        ) : null}
        {distinctCitations?.map((citation, index) => {
          return (
            <DocumentCitationEntry
              key={`${citation.source.id.id}-${citation.source.id.version}-${citation.targetFragment}`}
              citation={{
                ...citation,
                // @ts-expect-error
                document: documents.at(index)?.data?.document || null,
                // @ts-ignore
                author: citation.source.author
                  ? accounts[citation.source.author]
                  : null,
              }}
              ResourcePreview={ResourcePreview}
            />
          )
        })}
      </div>
    </AccessoryContent>
  )
}

function ResourcePreview({
  metadata,
  id,
}: {
  metadata?: HMMetadata | null
  id: UnpackedHypermediaId
}) {
  const doc = useResource(id)
  if (doc.isInitialLoading) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!doc.data) return null
  let content =
    doc.data.type === 'document' ? doc.data.document.content : undefined
  if (!content && doc.data.type === 'comment') {
    content = doc.data.comment.content
  }
  // todo, handle other resource types. type error below is reminding us of that.
  return (
    <div className="flex max-h-96 w-full max-w-xl flex-col gap-3 overflow-y-auto p-4">
      <SizableText size="2xl" weight="bold" className="px-2">
        {metadata?.name || 'Untitled'}
      </SizableText>
      <div className="h-px w-full flex-shrink-0 bg-gray-200 dark:bg-gray-800" />
      <AppDocContentProvider>
        <BlocksContent blocks={content} parentBlockId={null} />
      </AppDocContentProvider>
    </div>
  )
}

export function CommentCitationEntry({
  citation,
  accounts,
  targetDomain,
}: {
  citation: HMCitation
  accounts: HMAccountsMetadata
  targetDomain?: string
}) {
  const citationTargetFragment = citation.targetFragment
  const citationTarget = citation.targetId

  const comment = useComment(citation.source.id)
  const focusedComment = useMemo(() => {
    if (!comment.data) return comment.data
    if (
      comment.data.content.length === 1 &&
      // @ts-ignore
      comment.data.content[0].block.type === 'Embed'
    ) {
      const firstBlockNode = comment.data.content[0]
      // @ts-ignore
      const blockWithLink = getBlockWithLink(firstBlockNode.block)
      const singleEmbedId = blockWithLink
        ? unpackHmId(blockWithLink.link)
        : null
      if (
        firstBlockNode &&
        firstBlockNode.children?.length &&
        singleEmbedId &&
        singleEmbedId.id === citationTarget.id &&
        singleEmbedId.blockRef === citationTargetFragment?.blockId
      ) {
        return {
          ...comment.data,
          content: firstBlockNode.children,
        } satisfies HMComment
      }
    }
    return comment.data
  }, [comment.data, citationTargetFragment, citationTarget])
  const docId = comment.data ? hmId(comment.data.targetAccount) : undefined
  const replies = useCommentReplies(citation.source.id.uid, docId)

  if (!comment.data || !docId) return null
  if (!focusedComment) return null
  return (
    <Comment
      isLast={false}
      key={comment.data.id}
      comment={focusedComment}
      authorMetadata={accounts[comment.data.author]?.metadata}
      renderCommentContent={renderCommentContent}
      replyCount={replies?.length}
      targetDomain={targetDomain}
    />
  )
}

function getBlockWithLink(block: HMBlock) {
  if (block.type === 'Link') return block
  if (block.type === 'Embed') return block
  if (block.type === 'Button') return block

  return null
}
