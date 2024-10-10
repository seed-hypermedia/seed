import {AccessoryContainer} from '@/components/accessory-sidebar'
import {EntityLinkThumbnail} from '@/components/account-link-thumbnail'
import {useAccount_deprecated} from '@/models/accounts'
import {useComment} from '@/models/comments'
import {useEntityMentions} from '@/models/content-graph'
import {useDocTextContent} from '@/models/documents'
import {useEntity} from '@/models/entities'
import {useNavigate} from '@/utils/useNavigate'
import {
  BlockRange,
  DocumentRoute,
  ExpandedBlockRange,
  HYPERMEDIA_SCHEME,
  UnpackedHypermediaId,
  formattedDateMedium,
  getDocumentTitle,
  pluralS,
  serializeBlockRange,
  unpackHmId,
} from '@shm/shared'
import {Mention} from '@shm/shared/src/client/.generated/entities/v1alpha/entities_pb'
import {
  BlocksContent,
  ButtonText,
  PanelCard,
  SizableText,
  XStack,
  YStack,
  copyUrlToClipboardWithFeedback,
} from '@shm/ui'
import {useMemo} from 'react'
import {AppDocContentProvider} from '../pages/document-content-provider'

function CitationItem({mention}: {mention: Mention}) {
  if (!mention.source) throw 'Invalid citation'

  if (mention.source.startsWith(`${HYPERMEDIA_SCHEME}://d`)) {
    return <PublicationCitationItem mention={mention} />
  }

  if (mention.source.startsWith(`${HYPERMEDIA_SCHEME}://c`)) {
    return <CommentCitationItem mention={mention} />
  }

  return null
}

function PublicationCitationItem({mention}: {mention: Mention}) {
  const spawn = useNavigate('spawn')
  const unpackedSource = unpackHmId(mention.source)
  const doc = useEntity(
    unpackedSource
      ? {
          ...unpackedSource,
          version: mention.sourceBlob?.cid || null,
        }
      : undefined,
    {
      enabled: !!unpackedSource,
    },
  )
  let {data: account} = useAccount_deprecated(doc.data?.document?.owner)

  const docTextContent = useDocTextContent(doc.data?.document)
  const destRoute: DocumentRoute = {
    key: 'document',
    documentId: unpackedSource!.id,
    versionId: mention.sourceBlob?.cid,
    blockId: mention.sourceContext,
  }
  return (
    <PanelCard
      title={getDocumentTitle(doc.data?.document)}
      content={docTextContent}
      author={account}
      date={formattedDateMedium(doc.data?.document?.createTime)}
      onPress={() => {
        if (unpackedSource) {
          spawn(destRoute)
        }
      }}
      avatar={
        <EntityLinkThumbnail accountId={doc.data?.document?.owner} size={24} />
      }
    />
  )
}

function CommentCitationItem({mention}: {mention: Mention}) {
  const spawn = useNavigate('spawn')
  const unpackedSource = unpackHmId(mention.source)
  const {data: comment} = useComment(unpackedSource, {
    enabled: !!mention.source && !!unpackedSource,
  })

  const commentTarget = useMemo(() => {
    if (comment?.target) {
      return unpackHmId(comment.target)
    }
    return null
  }, [comment])

  const doc = useEntity(commentTarget)

  let {data: account} = useAccount_deprecated(comment?.author)

  return (
    <YStack
      overflow="hidden"
      borderRadius="$2"
      backgroundColor={'$backgroundTransparent'}
      hoverStyle={{
        backgroundColor: '$backgroundHover',
      }}
      margin="$4"
      padding="$4"
      paddingVertical="$4"
      gap="$2"
      onPress={() => {
        if (comment) {
          spawn({
            key: 'comment',
            commentId: comment.id,
            showThread: false,
          })
        }
      }}
    >
      <XStack gap="$2" ai="center">
        <EntityLinkThumbnail accountId={comment?.author} size={24} />
        <SizableText size="$2" fontWeight="600">
          {account?.profile?.alias || '...'}
        </SizableText>
        {doc.data ? (
          <>
            <SizableText flexShrink="0" size="$2">
              comment on{' '}
            </SizableText>
            <ButtonText
              size="$4"
              fontSize="$2"
              textDecorationLine="underline"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              width="100%"
              overflow="hidden"
              onPress={() => {
                if (commentTarget) {
                  spawn({
                    key: 'document',
                    documentId: commentTarget.id,
                    versionId: commentTarget.version || undefined,
                  })
                }
              }}
            >
              {getDocumentTitle(doc.data)}
            </ButtonText>
          </>
        ) : null}

        <XStack flex={1} />
        <SizableText
          flexShrink={0}
          size="$2"
          color="$color9"
          paddingHorizontal="$1"
        >
          {formattedDateMedium(comment?.createTime)}
        </SizableText>
      </XStack>
      <YStack gap="$2" flex={1} marginHorizontal="$-2">
        <AppDocContentProvider
          docId={doc.data?.id}
          comment
          // onReplyBlock={onReplyBlock}
          onCopyBlock={(
            blockId: string,
            blockRange: BlockRange | ExpandedBlockRange | undefined,
          ) => {
            const url = `${comment?.id}#${blockId}${serializeBlockRange(
              blockRange,
            )}`
            copyUrlToClipboardWithFeedback(url, 'Comment Block')
          }}
        >
          <BlocksContent blocks={comment?.content} parentBlockId={null} />
        </AppDocContentProvider>
      </YStack>
    </YStack>
  )
}

export function DocCitationsAccessory({
  docId,
  onClose,
}: {
  docId?: string
  onClose: () => void
}) {
  const mentions = useEntityMentions(docId)
  if (!docId) return null
  const count = mentions.data?.mentions?.length || 0

  const citationSet = new Set()
  const distinctMentions = mentions.data?.mentions.filter((item) => {
    if (!citationSet.has(item?.source)) {
      citationSet.add(item?.source)
      return true
    }
    return false
  })

  // TODO: This code also filters citations based on version of document where citation is used and on blockId, which was cited.
  // The current code will show only distinct documents, but if the first citation was in old version, it will point to the old version, which I feel is not good.
  // Maybe we could display version with document title, and/or blockId, which was cited.
  // const distinctMentions = citations?.links?.map(item => {
  //   const { source, target } = item;
  //   const combination = `${source?.documentId}-${source?.version}-${target?.blockId}`;

  //   if (!citationSet.has(combination)) {
  //     citationSet.add(combination);
  //     return item
  //   }

  //   return null;
  // }).filter(item => item !== null);

  return (
    <AccessoryContainer
      title={`${count} ${pluralS(count, 'Citation')}`}
      onClose={onClose}
    >
      {distinctMentions?.map((mention, index) => (
        <CitationItem
          key={`${mention.source}${mention.targetVersion}${mention.targetFragment}`}
          mention={mention}
        />
      ))}
    </AccessoryContainer>
  )
}

export function EntityCitationsAccessory({
  entityId,
  onClose,
}: {
  entityId?: UnpackedHypermediaId
  onClose: () => void
}) {
  const mentions = useEntityMentions(entityId)
  if (!entityId) return null
  const count = mentions?.data?.mentions?.length || 0

  const citationSet = new Set()
  const distinctMentions = mentions?.data?.mentions?.filter((item) => {
    if (!citationSet.has(item?.source)) {
      citationSet.add(item?.source)
      return true
    }
    return false
  })

  return (
    <AccessoryContainer
      title={`${count} ${pluralS(count, 'Citation')}`}
      onClose={onClose}
    >
      {distinctMentions?.map((mention, index) => (
        <CitationItem
          key={`${mention.source}${mention.targetVersion}${mention.targetFragment}`}
          mention={mention}
        />
      ))}
    </AccessoryContainer>
  )
}
