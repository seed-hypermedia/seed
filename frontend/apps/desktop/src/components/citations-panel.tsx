import {useEntityCitations} from '@/models/citations'
import {useComment, useCommentReplies} from '@/models/comments'
import {useContactsMetadata} from '@/models/contacts'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {
  DocumentCitationsAccessory,
  entityQueryPathToHmIdPath,
  hmId,
  unpackHmId,
} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMBlock,
  HMCitation,
  HMComment,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntity, useResolvedEntities} from '@shm/shared/models/entity'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {DocumentCitationEntry} from '@shm/ui/citations'
import {Comment} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {useMemo} from 'react'
import {YStack} from 'tamagui'
import {AccessoryContent} from './accessory-sidebar'
import {renderCommentContent} from './commenting'

export function CitationsPanel({
  entityId,
  accessory,
  onAccessory,
}: {
  entityId?: UnpackedHypermediaId
  accessory: DocumentCitationsAccessory
  onAccessory: (accessory: DocumentCitationsAccessory) => void
}) {
  const citations = useEntityCitations(entityId)
  if (!entityId) return null

  const citationSet = new Set()
  const distinctCitations = citations?.data
    ?.filter(
      (item) =>
        !accessory.openBlockId ||
        item.targetFragment?.blockId === accessory.openBlockId,
    )
    ?.filter((item) => {
      if (!citationSet.has(item?.source.id.id)) {
        citationSet.add(item?.source.id.id)
        return true
      }
      return false
    })
    .filter((item) => item.source.type === 'd')
  const distinctCount = distinctCitations?.length || 0
  const accountsToLoad = new Set<string>()
  distinctCitations?.forEach((citation) => {
    if (citation.source.author) {
      accountsToLoad.add(citation.source.author)
    }
  })
  const documents = useResolvedEntities(
    (distinctCitations
      ?.map((citation) =>
        citation.source.type === 'd' ? citation.source.id : null,
      )
      .filter((id) => id !== null) as UnpackedHypermediaId[]) || [],
  )
  const accounts = useContactsMetadata(Array.from(accountsToLoad))
  return (
    <AccessoryContent>
      <YStack gap="$3">
        {accessory.openBlockId ? (
          <AccessoryBackButton
            label="All Citations"
            onPress={() => onAccessory({...accessory, openBlockId: null})}
          />
        ) : null}
        {distinctCitations?.map((citation, index) => {
          return (
            <DocumentCitationEntry
              key={`${citation.source.id.id}-${citation.source.id.version}-${citation.targetFragment}`}
              citation={{
                ...citation,
                document: documents.at(index)?.data?.document || null,
                author: citation.source.author
                  ? accounts[citation.source.author]
                  : null,
              }}
              DocPreview={DocumentPreview}
            />
          )
        })}
      </YStack>
    </AccessoryContent>
  )
}

function DocumentPreview({
  metadata,
  docId,
}: {
  metadata?: HMMetadata | null
  docId: UnpackedHypermediaId
}) {
  const doc = useEntity(docId)
  if (doc.isInitialLoading) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!doc.data) return null

  return (
    <div className="flex flex-col w-full max-w-xl gap-3 overflow-y-auto rounded-lg max-h-96">
      <SizableText size="2xl" weight="bold" className="px-2">
        {metadata?.name || 'Untitled'}
      </SizableText>
      <div className="flex-shrink-0 w-full h-px bg-gray-200 dark:bg-gray-800" />
      <AppDocContentProvider>
        <BlocksContent
          blocks={doc.data.document?.content}
          parentBlockId={null}
        />
      </AppDocContentProvider>
    </div>
  )
}

export function CommentCitationEntry({
  citation,
  accounts,
}: {
  citation: HMCitation
  accounts: HMAccountsMetadata
}) {
  const citationTargetFragment = citation.targetFragment
  const citationTarget = citation.targetId
  const comment = useComment(citation.source.id)
  const focusedComment = useMemo(() => {
    if (!comment.data) return comment.data
    if (
      comment.data.content.length === 1 &&
      comment.data.content[0].block.type === 'Embed'
    ) {
      const firstBlockNode = comment.data.content[0]
      const blockWithLink = getBlockWithLink(firstBlockNode.block)
      const singleEmbedId = blockWithLink
        ? unpackHmId(blockWithLink.link)
        : null
      if (
        firstBlockNode.children?.length &&
        singleEmbedId?.type === citationTarget.type &&
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
  const docId = comment.data
    ? hmId('d', comment.data.targetAccount, {
        path: entityQueryPathToHmIdPath(comment.data.targetPath),
        version: comment.data.targetVersion,
      })
    : undefined
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
    />
  )
}

function getBlockWithLink(block: HMBlock) {
  if (block.type === 'Link') return block
  if (block.type === 'Embed') return block
  if (block.type === 'Button') return block

  return null
}
