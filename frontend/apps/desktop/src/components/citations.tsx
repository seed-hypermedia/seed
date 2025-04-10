import {AccessoryContainer} from '@/components/accessory-sidebar'
import {useEntityCitations} from '@/models/citations'
import {useComment} from '@/models/comments'
import {useAccountsMetadata} from '@/models/entities'
import {useNavigate} from '@/utils/useNavigate'
import {entityQueryPathToHmIdPath, formattedDateShort} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMCitation,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {pluralS} from '@shm/shared/utils/language'
import {Comment} from '@shm/ui/discussion'
import {HMIcon} from '@shm/ui/hm-icon'
import {Button, SizableText, styled, XStack} from 'tamagui'
import {CommentReplies, renderCommentContent, RepliesEditor} from './commenting'

// function CitationItem({mention}: {mention: Mention}) {
//   if (!mention.source) throw 'Invalid citation'

//   if (mention.source.startsWith(`${HYPERMEDIA_SCHEME}://d`)) {
//     return <PublicationCitationItem mention={mention} />
//   }

//   if (mention.source.startsWith(`${HYPERMEDIA_SCHEME}://c`)) {
//     return <CommentCitationItem mention={mention} />
//   }

//   return null
// }

// function PublicationCitationItem({mention}: {mention: Mention}) {
//   const spawn = useNavigate('spawn')
//   const unpackedSource = unpackHmId(mention.source)
//   const doc = useEntity(
//     unpackedSource
//       ? {
//           ...unpackedSource,
//           version: mention.sourceBlob?.cid || null,
//         }
//       : undefined,
//     {
//       enabled: !!unpackedSource,
//     },
//   )
//   let {data: account} = useAccount_deprecated(doc.data?.document?.owner)

//   const docTextContent = useDocTextContent(doc.data?.document)
//   const destRoute: DocumentRoute = {
//     key: 'document',
//     documentId: unpackedSource!.id,
//     versionId: mention.sourceBlob?.cid,
//     blockId: mention.sourceContext,
//   }
//   return (
//     <PanelCard
//       title={getDocumentTitle(doc.data?.document)}
//       content={docTextContent}
//       author={account}
//       date={formattedDateMedium(doc.data?.document?.createTime)}
//       onPress={() => {
//         if (unpackedSource) {
//           spawn(destRoute)
//         }
//       }}
//       avatar={
//         <EntityLinkIcon accountId={doc.data?.document?.owner} size={24} />
//       }
//     />
//   )
// }

// function CommentCitationItem({mention}: {mention: Mention}) {
//   const spawn = useNavigate('spawn')
//   const unpackedSource = unpackHmId(mention.source)
//   const {data: comment} = useComment(unpackedSource, {
//     enabled: !!mention.source && !!unpackedSource,
//   })

//   const commentTarget = useMemo(() => {
//     if (comment?.target) {
//       return unpackHmId(comment.target)
//     }
//     return null
//   }, [comment])

//   const doc = useEntity(commentTarget)

//   let {data: account} = useAccount_deprecated(comment?.author)

//   return (
//     <YStack
//       overflow="hidden"
//       borderRadius="$2"
//       backgroundColor={'$backgroundTransparent'}
//       hoverStyle={{
//         backgroundColor: '$backgroundHover',
//       }}
//       margin="$4"
//       padding="$4"
//       paddingVertical="$4"
//       gap="$2"
//       onPress={() => {
//         if (comment) {
//           spawn({
//             key: 'comment',
//             commentId: comment.id,
//             showThread: false,
//           })
//         }
//       }}
//     >
//       <XStack gap="$2" ai="center">
//         <EntityLinkIcon accountId={comment?.author} size={24} />
//         <SizableText size="$2" fontWeight="600">
//           {account?.profile?.alias || '...'}
//         </SizableText>
//         {doc.data ? (
//           <>
//             <SizableText flexShrink="0" size="$2">
//               comment on{' '}
//             </SizableText>
//             <ButtonText
//               size="$4"
//               fontSize="$2"
//               textDecorationLine="underline"
//               textDecorationColor="currentColor"
//               textOverflow="ellipsis"
//               whiteSpace="nowrap"
//               width="100%"
//               overflow="hidden"
//               onPress={() => {
//                 if (commentTarget) {
//                   spawn({
//                     key: 'document',
//                     documentId: commentTarget.id,
//                     versionId: commentTarget.version || undefined,
//                   })
//                 }
//               }}
//             >
//               {getDocumentTitle(doc.data)}
//             </ButtonText>
//           </>
//         ) : null}

//         <XStack flex={1} />
//         <SizableText
//           flexShrink={0}
//           size="$2"
//           color="$color9"
//           paddingHorizontal="$1"
//         >
//           {formattedDateMedium(comment?.createTime)}
//         </SizableText>
//       </XStack>
//       <YStack gap="$2" flex={1} marginHorizontal="$-2">
//         <AppDocContentProvider
//           docId={doc.data?.id}
//           comment
//           // onReplyBlock={onReplyBlock}
//           onCopyBlock={(
//             blockId: string,
//             blockRange: BlockRange | ExpandedBlockRange | undefined,
//           ) => {
//             const url = `${comment?.id}#${blockId}${serializeBlockRange(
//               blockRange,
//             )}`
//             copyUrlToClipboardWithFeedback(url, 'Comment Block')
//           }}
//         >
//           <BlocksContent blocks={comment?.content} parentBlockId={null} />
//         </AppDocContentProvider>
//       </YStack>
//     </YStack>
//   )
// }

// export function DocCitationsAccessory({
//   docId,
//   onClose,
// }: {
//   docId?: string
//   onClose: () => void
// }) {
//   const mentions = useEntityMentions(docId)
//   if (!docId) return null
//   const count = mentions.data?.mentions?.length || 0

//   const citationSet = new Set()
//   const distinctMentions = mentions.data?.mentions.filter((item) => {
//     if (!citationSet.has(item?.source)) {
//       citationSet.add(item?.source)
//       return true
//     }
//     return false
//   })

//   // TODO: This code also filters citations based on version of document where citation is used and on blockId, which was cited.
//   // The current code will show only distinct documents, but if the first citation was in old version, it will point to the old version, which I feel is not good.
//   // Maybe we could display version with document title, and/or blockId, which was cited.
//   // const distinctMentions = citations?.links?.map(item => {
//   //   const { source, target } = item;
//   //   const combination = `${source?.documentId}-${source?.version}-${target?.blockId}`;

//   //   if (!citationSet.has(combination)) {
//   //     citationSet.add(combination);
//   //     return item
//   //   }

//   //   return null;
//   // }).filter(item => item !== null);

//   return (
//     <AccessoryContainer
//       title={`${count} ${pluralS(count, 'Citation')}`}
//       onClose={onClose}
//     >
//       {distinctMentions?.map((mention, index) => (
//         <CitationItem
//           key={`${mention.source}${mention.targetVersion}${mention.targetFragment}`}
//           mention={mention}
//         />
//       ))}
//     </AccessoryContainer>
//   )
// }

export function CitationsPanel({
  entityId,
  onClose,
}: {
  entityId?: UnpackedHypermediaId
  onClose: () => void
}) {
  const citations = useEntityCitations(entityId)
  console.log('~~~ citations', citations.data)
  if (!entityId) return null

  const citationSet = new Set()
  const distinctCitations = citations?.data?.filter((item) => {
    if (!citationSet.has(item?.source)) {
      citationSet.add(item?.source)
      return true
    }
    return false
  })
  const distinctCount = distinctCitations?.length || 0
  const accountsToLoad = new Set<string>()
  distinctCitations?.forEach((citation) => {
    if (citation.source.author) {
      accountsToLoad.add(citation.source.author)
    }
  })
  const accounts = useAccountsMetadata(Array.from(accountsToLoad))
  console.log('~~~ accounts', accounts)
  return (
    <AccessoryContainer
      title={`${distinctCount} ${pluralS(distinctCount, 'Citation')}`}
      onClose={onClose}
    >
      {distinctCitations?.map((citation, index) => (
        <CitationEntry
          key={`${citation.source}${citation.targetFragment}`}
          citation={citation}
          accounts={accounts}
        />
      ))}
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
    return <DocumentCitation citation={citation} accounts={accounts} />
  }
  return <SizableText>Unsupported Citation Type</SizableText>
}

function DocumentCitation({
  citation,
  accounts,
}: {
  citation: HMCitation
  accounts: HMAccountsMetadata
}) {
  const doc = useEntity(citation.source.id)
  const navigate = useNavigate()
  if (!doc.data) return null
  console.log('~~~ doc citation', citation, doc.data)
  const author = citation.source.author
    ? accounts[citation.source.author]
    : null
  if (!author) return null
  console.log('~~~ doc citation author', author)
  return (
    <XStack gap="$1" ai="center" flexWrap="wrap">
      <HMAuthor author={author} />
      <CitationDateText>
        {formattedDateShort(citation.source.time)}
      </CitationDateText>
      <XStack gap="$2" ai="center">
        <SizableText>cited on</SizableText>
        <DocumentCitationButton
          onPress={() => {
            doc.data && navigate({key: 'document', id: doc.data.id})
          }}
        >
          {doc.data?.document?.metadata?.name}
        </DocumentCitationButton>
      </XStack>
    </XStack>
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
        9 // todo
        // isLastCommentInGroup ? commentGroup.moreCommentsCount : undefined
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
