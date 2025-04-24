import {AccessoryContainer} from '@/components/accessory-sidebar'
import {useEntityCitations} from '@/models/citations'
import {useComment} from '@/models/comments'
import {useAccountsMetadata} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {
  DocumentCitationsAccessory,
  entityQueryPathToHmIdPath,
  hmId,
} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMCitation,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntity, useResolvedEntities} from '@shm/shared/models/entity'
import {pluralS} from '@shm/shared/utils/language'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {DocumentCitationEntry} from '@shm/ui/citations'
import {Comment} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {SizableText, Spinner, YStack} from 'tamagui'
import {CommentReplies, renderCommentContent, RepliesEditor} from './commenting'

export function CitationsPanel({
  entityId,
  onClose,
  accessory,
  onAccessory,
}: {
  entityId?: UnpackedHypermediaId
  onClose: () => void
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
    <AccessoryContainer
      title={`${distinctCount} ${pluralS(distinctCount, 'Citation')}`}
      onClose={onClose}
    >
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
    </AccessoryContainer>
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
    return <Spinner />
  }
  if (!doc.data) return null

  return (
    <YStack maxHeight="50vh" maxWidth={600} overflowY="auto">
      <SizableText
        fontSize="$9"
        fontWeight="bold"
        marginHorizontal="$2"
        marginVertical="$5"
      >
        {metadata?.name}
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
  const comment = useComment(citation.source.id)
  if (!comment.data) return null
  const docId = hmId('d', comment.data.targetAccount, {
    path: entityQueryPathToHmIdPath(comment.data.targetPath),
    version: comment.data.targetVersion,
  })
  return (
    <Comment
      isFirst={false}
      isLast={false}
      isNested={false}
      key={comment.data.id}
      docId={docId}
      comment={comment.data}
      rootReplyCommentId={comment.data.threadRoot}
      authorMetadata={accounts[comment.data.author]?.metadata}
      renderCommentContent={renderCommentContent}
      replyCount={
        // 9 // todo
        // // isLastCommentInGroup ? commentGroup.moreCommentsCount : undefined
        0
      }
      enableWebSigning={true}
      RepliesEditor={RepliesEditor}
      CommentReplies={CommentReplies}
      // enableReplies={enableReplies}
      // homeId={homeId}
      // siteHost={siteHost}
    />
  )
}
