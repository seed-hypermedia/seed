import {useEntityCitations} from '@/models/citations'
import {useComment, useCommentReplies} from '@/models/comments'
import {useAccountsMetadata} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {
  DocumentCitationsAccessory,
  entityQueryPathToHmIdPath,
  hmId,
  unpackHmId,
} from '@shm/shared'
import {
  HMAccountsMetadata,
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
      if (!citationSet.has(item?.source)) {
        citationSet.add(item?.source)
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
  const accounts = useAccountsMetadata(Array.from(accountsToLoad))
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
              key={`${citation.source}${citation.targetFragment}`}
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
      <div className="flex justify-center items-center">
        <Spinner />
      </div>
    )
  }
  if (!doc.data) return null

  return (
    <YStack maxHeight="50vh" maxWidth={600} overflow="auto">
      <SizableText size="2xl" weight="bold" className="mx-2 my-5">
        {metadata?.name || 'Untitled'}
      </SizableText>
      <AppDocContentProvider>
        <BlocksContent
          blocks={doc.data.document?.content}
          parentBlockId={null}
        />
      </AppDocContentProvider>
    </YStack>
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
      const singleEmbedId = unpackHmId(firstBlockNode.block.link)
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
      rootReplyCommentId={comment.data.threadRoot ?? null}
      authorMetadata={accounts[comment.data.author]?.metadata}
      renderCommentContent={renderCommentContent}
      replyCount={replies?.length}
    />
  )
}
