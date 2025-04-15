import {AccessoryContainer} from '@/components/accessory-sidebar'
import {useEntityCitations} from '@/models/citations'
import {useComment} from '@/models/comments'
import {useAccountsMetadata} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {useNavigate} from '@/utils/useNavigate'
import {entityQueryPathToHmIdPath, formattedDateShort} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMCitation,
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {pluralS} from '@shm/shared/utils/language'
import {Comment} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {HoverCard} from '@shm/ui/hover-card'
import {Button, SizableText, Spinner, styled, XStack, YStack} from 'tamagui'
import {CommentReplies, renderCommentContent, RepliesEditor} from './commenting'

export function CitationsPanel({
  entityId,
  onClose,
}: {
  entityId?: UnpackedHypermediaId
  onClose: () => void
}) {
  const citations = useEntityCitations(entityId)
  if (!entityId) return null

  const citationSet = new Set()
  const distinctCitations = citations?.data
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
  const accounts = useAccountsMetadata(Array.from(accountsToLoad))
  return (
    <AccessoryContainer
      title={`${distinctCount} ${pluralS(distinctCount, 'Citation')}`}
      onClose={onClose}
    >
      {distinctCitations?.map((citation, index) => {
        return (
          <CitationEntry
            key={`${citation.source}${citation.targetFragment}`}
            citation={citation}
            accounts={accounts}
          />
        )
      })}
    </AccessoryContainer>
  )
}

export function CitationEntry({
  citation,
  accounts,
}: {
  citation: HMCitation
  accounts: HMAccountsMetadata
}) {
  if (citation.source.type === 'c') {
    return <CommentCitation citation={citation} accounts={accounts} />
  }
  if (citation.source.type === 'd') {
    return <DocumentCitationEntry citation={citation} accounts={accounts} />
  }
  return <SizableText>Unsupported Citation Type</SizableText>
}

function DocumentCitationEntry({
  citation,
  accounts,
}: {
  citation: HMCitation
  accounts: HMAccountsMetadata
}) {
  const doc = useEntity(citation.source.id)
  const navigate = useNavigate()
  if (!doc.data) return null
  const author = citation.source.author
    ? accounts[citation.source.author]
    : null
  if (!author) return null
  return (
    <XStack gap="$1" ai="center" flexWrap="wrap">
      <HMAuthor author={author} />
      <CitationDateText>
        {formattedDateShort(citation.source.time)}
      </CitationDateText>
      <XStack gap="$2" ai="center">
        <SizableText>cited on</SizableText>
        <DocumentCitationToken
          docId={doc.data.id}
          metadata={doc.data?.document?.metadata}
          onPress={() => {
            doc.data && navigate({key: 'document', id: doc.data.id})
          }}
        />
      </XStack>
    </XStack>
  )
}

function DocumentCitationToken({
  docId,
  onPress,
  metadata,
}: {
  docId: UnpackedHypermediaId
  onPress: () => void
  metadata?: HMMetadata | null
}) {
  return (
    <HoverCard
      placement="left"
      content={<HMDocumentPreview metadata={metadata} docId={docId} />}
    >
      <DocumentCitationButton onPress={onPress}>
        {metadata?.name}
      </DocumentCitationButton>
    </HoverCard>
  )
}

function HMDocumentPreview({
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

function HMAuthor({author}: {author: HMMetadataPayload}) {
  const navigate = useNavigate()
  return (
    <Button
      size="$2"
      chromeless
      onPress={() => {
        navigate({key: 'document', id: author.id})
      }}
    >
      <XStack gap="$2" ai="center">
        <HMIcon size={20} id={author.id} metadata={author.metadata} />
        <SizableText fontWeight="bold">{author.metadata?.name}</SizableText>
      </XStack>
    </Button>
  )
}

const CitationDateText = styled(SizableText, {
  color: '$color8',
  marginRight: '$2',
})

const DocumentCitationButton = styled(Button, {
  backgroundColor: '$color6',
  size: '$1',
  fontSize: '$4',
  hoverStyle: {
    backgroundColor: '$color2',
  },
})

function CommentCitation({
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
