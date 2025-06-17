import {cborDecode, SignedComment} from '@/api'
import {WebCommenting} from '@/client-lazy'
import {WebDocContentProvider} from '@/doc-content-provider'
import {
  getComment,
  getMetadata,
  getOriginRequestData,
  resolveHMDocument,
} from '@/loaders'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'

import {unwrap, wrapJSON} from '@/wrapping'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData, useSearchParams} from '@remix-run/react'
import {
  HMAccountsMetadata,
  HMAnnotation,
  HMBlock,
  HMBlockNode,
  HMComment,
  HMDocument,
  hmId,
  HMMetadata,
  HMMetadataPayload,
  HMPublishableAnnotation,
  HMPublishableBlock,
  UnpackedHypermediaId,
  unpackHmId,
  useRouteLink,
} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {Comment, QuotedDocBlock} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {SmallSiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Heading} from '@tamagui/text'
import {useMutation} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import {useCallback, useMemo, useState} from 'react'
import {Button, ButtonText, View, XStack, YStack} from 'tamagui'

import {defaultSiteIcon} from '@/meta'
import {useTx} from '@shm/shared/translation'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {CommentPayload} from './hm.api.comment'
import {SyncCommentRequest} from './hm.api.sync-comment'

type CommentPagePayload = {
  enableWebSigning: boolean
  targetAuthors: HMAccountsMetadata
  targetDocument: HMDocument
  targetId: UnpackedHypermediaId
  originHomeId: UnpackedHypermediaId | undefined
  originHomeMetadata: HMMetadata | undefined
  origin: string
  replyComment?:
    | {
        comment: HMComment
        author: HMMetadataPayload
      }
    | undefined
} & ReturnType<typeof getOriginRequestData>

export const meta: MetaFunction = ({data}) => {
  const {targetDocument, originHomeMetadata} = unwrap<CommentPagePayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIcon = originHomeMetadata?.icon
    ? getOptimizedImageUrl(extractIpfsUrlCid(originHomeMetadata.icon), 'S')
    : null
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })
  meta.push({
    title: `Comment on ${targetDocument.metadata.name ?? 'Untitled Document'}`,
  })
  return meta
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const config = await getConfig(parsedRequest.hostname)
  const targetStr = parsedRequest.searchParams.get('target')
  const replyCommentId = parsedRequest.searchParams.get('replyId')
  const targetVersion = parsedRequest.searchParams.get('targetVersion')
  const targetIdBare = targetStr ? unpackHmId(`hm://${targetStr}`) : undefined
  const targetId = targetIdBare
    ? {
        ...targetIdBare,
        version: targetVersion,
      }
    : undefined
  const targetDocument =
    targetId && (await resolveHMDocument(targetId, {discover: true}))
  const targetAuthors = await Promise.all(
    targetDocument?.authors.map(async (authorUid) => {
      return await getMetadata(hmId('d', authorUid))
    }) ?? [],
  )
  if (!targetDocument || !targetId) {
    return wrapJSON(
      {
        error: 'Invalid target',
      },
      {
        status: 400,
      },
    )
  }
  const originHome = config?.registeredAccountUid
    ? await getMetadata(hmId('d', config.registeredAccountUid))
    : undefined
  const replyComment = replyCommentId
    ? await getComment(replyCommentId)
    : undefined
  return wrapJSON({
    targetAuthors: Object.fromEntries(
      targetAuthors.map((author) => [author.id.uid, author]),
    ),
    targetDocument,
    targetId,
    replyComment: replyComment
      ? {
          comment: replyComment,
          author: await getMetadata(hmId('d', replyComment.author)),
        }
      : undefined,
    originHomeId: config?.registeredAccountUid
      ? hmId('d', config.registeredAccountUid)
      : undefined,
    ...getOriginRequestData(parsedRequest),
    originHomeMetadata: originHome?.metadata ?? undefined,
  } satisfies CommentPagePayload)
}

export default function CreateComment() {
  const {
    enableWebSigning,
    targetDocument,
    targetId,
    targetAuthors,
    originHomeId,
    siteHost,
    origin,
    replyComment,
    originHomeMetadata,
  } = unwrap<CommentPagePayload>(useLoaderData())

  const [params] = useSearchParams()
  const originUrl = params.get('originUrl') || undefined
  const originUrlUrl = originUrl ? new URL(originUrl) : undefined
  const replyCommentId = params.get('replyId')
  const replyCommentVersion = params.get('replyVersion')
  const rootReplyCommentVersion = params.get('rootReplyVersion')
  const quotingBlockId = params.get('quoteBlock')

  const [retry, setRetry] = useState<(() => void) | null>(null)
  const syncComment = useMutation({
    mutationFn: async (req: SyncCommentRequest) => {
      if (!originUrlUrl) throw new Error('')
      const resp = await fetch(`${originUrlUrl.origin}/hm/api/sync-comment`, {
        method: 'POST',
        body: JSON.stringify(req),
      })
      if (!resp.ok) {
        throw new Error('Failed to sync comment')
      }
      return resp.json()
    },
    onSuccess: () => {
      setRetry(null)
    },
  })
  const [publishedComment, setPublishedComment] = useState<{
    id: string
    raw: CommentPayload
  } | null>(null)

  const tx = useTx()
  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        <WebDocContentProvider
          key={comment.id}
          originHomeId={originHomeId}
          // id={id}
          siteHost={siteHost}
          comment={true}
        >
          <BlocksContent blocks={comment.content} parentBlockId={null} />
        </WebDocContentProvider>
      )
    },
    [originHomeId],
  )
  if (!targetId) {
    return <Heading>Invalid target</Heading>
  }
  if (!originHomeId) {
    return <Heading>Invalid origin home id</Heading>
  }
  if (!originUrl) {
    return <Heading>Invalid origin url</Heading>
  }

  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
    >
      <YStack ai="center" flex={1} minHeight="100vh">
        {originHomeMetadata && (
          <SmallSiteHeader
            originHomeMetadata={originHomeMetadata}
            originHomeId={originHomeId}
            siteHost={siteHost}
          />
        )}
        <YStack
          flex={1}
          gap="$3"
          width="100%"
          maxWidth={600}
          paddingTop="$4"
          paddingHorizontal={0}
        >
          <View paddingHorizontal="$4">
            <SizableText size="lg">
              {replyComment
                ? tx(
                    'replying_to',
                    (args) => <>Replying to {args.replyAuthor}</>,
                    {
                      replyAuthor: (
                        <SizableText size="lg" weight="bold">
                          {replyComment.author.metadata?.name ??
                            'Unknown Author'}
                        </SizableText>
                      ),
                    },
                  )
                : tx('comment_on', (args) => <>Comment on {args.target}</>, {
                    target: (
                      <DocButtonLink
                        docId={targetId}
                        name={
                          targetDocument.metadata.name ?? 'Untitled Document'
                        }
                      />
                    ),
                  })}
            </SizableText>
            {/* <NewspaperCard
              overflow="hidden"
              docId={targetId}
              entity={{
                id: targetId,
                document: targetDocument,
              }}
              accountsMetadata={targetAuthors}
            /> */}
          </View>
          {quotingBlockId ? (
            <View marginHorizontal="$4">
              <WebDocContentProvider
                originHomeId={originHomeId}
                siteHost={siteHost}
              >
                <QuotedDocBlock
                  docId={targetId}
                  blockId={quotingBlockId}
                  doc={targetDocument}
                />
              </WebDocContentProvider>
            </View>
          ) : null}
          <YStack paddingHorizontal="$4">
            {replyComment ? (
              <Comment
                isLast={!publishedComment}
                comment={replyComment.comment}
                renderCommentContent={renderCommentContent}
                authorMetadata={replyComment.author.metadata}
              />
            ) : null}
            {publishedComment ? (
              <>
                <SyncCommentFeedback
                  isLoading={syncComment.isLoading}
                  hostname={originUrlUrl?.hostname ?? ''}
                  // @ts-expect-error - error types are bad...
                  error={syncComment.error?.message}
                  retry={retry}
                />
                <PublishedComment
                  commentId={publishedComment.id}
                  siteHost={siteHost}
                  comment={publishedComment.raw}
                  targetId={targetId}
                  enableWebSigning={enableWebSigning}
                  originHomeId={originHomeId}
                  isFirst={!replyComment}
                  isLast={true}
                />
              </>
            ) : null}
          </YStack>
          <View paddingHorizontal="$4" flex={1}>
            {publishedComment ? null : (
              <WebCommenting
                docId={targetId}
                replyCommentId={replyCommentId || undefined}
                replyCommentVersion={replyCommentVersion || undefined}
                rootReplyCommentVersion={rootReplyCommentVersion || undefined}
                enableWebSigning={enableWebSigning}
                quotingBlockId={quotingBlockId || undefined}
                commentingOriginUrl={originUrl}
                onSuccess={(result) => {
                  if (originUrl) {
                    setPublishedComment({
                      id: result.response.commentId,
                      raw: result.commentPayload,
                    })
                    function attemptSync() {
                      syncComment.mutate({
                        commentId: result.response.commentId,
                        target: targetId.id,
                        dependencies: result.response.dependencies,
                      })
                    }
                    setRetry(() => attemptSync)
                    attemptSync()
                  }
                }}
              />
            )}
            {syncComment.isSuccess && originUrlUrl ? (
              <Button
                backgroundColor="$brand5"
                hoverStyle={{backgroundColor: '$brand4'}}
                focusStyle={{backgroundColor: '$brand4'}}
                tag="a"
                style={{textDecorationLine: 'none'}}
                color="$color1"
                href={originUrl}
              >
                {`Go back to ${originUrlUrl.hostname}`}
              </Button>
            ) : null}
          </View>
          <PageFooter enableWebSigning={enableWebSigning} />
        </YStack>
      </YStack>
    </WebSiteProvider>
  )
}

function DocButtonLink({
  docId,
  name,
}: {
  docId: UnpackedHypermediaId
  name: string
}) {
  const linkProps = useRouteLink({key: 'document', id: docId})
  return (
    <ButtonText
      {...linkProps}
      textDecorationLine="underline"
      fontWeight="bold"
      fontSize="$5"
      whiteSpace="wrap"
    >
      {name}
    </ButtonText>
  )
}

function SyncCommentFeedback({
  isLoading,
  hostname,
  error,
  retry,
}: {
  isLoading: boolean
  hostname: string
  error: string | undefined
  retry: (() => void) | null
}) {
  let bgColor = '$color3'
  let borderColor = '$color9'
  let statusText = `Synced to ${hostname}`
  if (isLoading) {
    statusText = `Syncing to ${hostname}...`
  } else if (error) {
    bgColor = '$red1'
    borderColor = '$red9'
    statusText = `Error: ${error}`
  }
  return (
    <XStack
      jc="space-between"
      borderWidth={1}
      borderRadius="$3"
      borderColor={borderColor}
      padding="$2"
      backgroundColor={bgColor}
    >
      <SizableText className="text-current">{statusText}</SizableText>
      {isLoading && <Spinner width={20} height={20} />}
      {retry && !isLoading ? (
        <Button onPress={retry} size="$1" theme="red">
          Retry
        </Button>
      ) : null}
    </XStack>
  )
}

function PublishedComment({
  commentId,
  comment,
  targetId,
  enableWebSigning,
  originHomeId,
  siteHost,
  isFirst = true,
  isLast = true,
}: {
  commentId: string
  comment: CommentPayload
  targetId: UnpackedHypermediaId
  enableWebSigning: boolean
  originHomeId: UnpackedHypermediaId
  siteHost: string
  isFirst: boolean
  isLast: boolean
}) {
  const rawComment = useMemo(() => {
    const c = cborDecode<SignedComment>(comment.comment)
    const signerId = hmId('d', base58btc.encode(c.signer))
    return {
      c,
      signerId,
    }
  }, [comment])
  const author = useEntity(rawComment.signerId)
  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        <WebDocContentProvider
          key={comment.id}
          originHomeId={originHomeId}
          // id={id}
          siteHost={siteHost}
          comment={true}
        >
          <BlocksContent blocks={comment.content} parentBlockId={null} />
        </WebDocContentProvider>
      )
    },
    [originHomeId],
  )
  return (
    <Comment
      comment={useMemo(
        () => signedCommentToHMComment(commentId, rawComment.c),
        [commentId, rawComment],
      )}
      renderCommentContent={renderCommentContent}
      isLast={isLast}
      authorMetadata={author.data?.document?.metadata ?? undefined}
    />
  )
}

function signedCommentToHMComment(
  id: string,
  signedComment: SignedComment,
): HMComment {
  return {
    content: signedComment.body.map(publishableBlockToHMBlockNode),
    author: base58btc.encode(signedComment.signer),
    id,
    targetAccount: base58btc.encode(signedComment.space),
    targetPath: signedComment.path,
    targetVersion: signedComment.version.map((v) => v.toString()).join('.'),
    createTime: {
      seconds: BigInt(signedComment.ts) / 1000n,
      nanos: Number((BigInt(signedComment.ts) % 1000n) * 1000000n),
    },
    capability: '', // the signed comment does not include the cap?!
    threadRoot: signedComment.threadRoot?.toString() ?? '',
    replyParent: signedComment.replyParent?.toString() ?? '',
  }
}

function publishableBlockToHMBlockNode(
  publishableBlock: HMPublishableBlock,
): HMBlockNode {
  return {
    block: publishableBlockToHMBlock(publishableBlock),
    children: publishableBlock.children?.map(publishableBlockToHMBlockNode),
  }
}

function publishableBlockToHMBlock(
  publishableBlock: HMPublishableBlock,
): HMBlock {
  const convertAnnotation = (
    annotation: HMPublishableAnnotation,
  ): HMAnnotation => {
    const base = {
      starts: annotation.starts,
      ends: annotation.ends,
      attributes: {},
    }

    if (annotation.type === 'Link') {
      return {
        ...base,
        type: 'Link',
        link: annotation.link,
      }
    }
    if (annotation.type === 'Embed') {
      return {
        ...base,
        type: 'Embed',
        link: annotation.link,
      }
    }
    return {
      ...base,
      type: annotation.type,
      link: '',
    }
  }

  const annotations =
    'annotations' in publishableBlock && publishableBlock.annotations
      ? publishableBlock.annotations.map(convertAnnotation)
      : []

  const base = {
    id: publishableBlock.id,
    attributes: {},
  }

  if (publishableBlock.type === 'Paragraph') {
    return {
      ...base,
      type: 'Paragraph',
      text: publishableBlock.text,
      annotations,
    }
  }
  if (publishableBlock.type === 'Heading') {
    return {
      ...base,
      type: 'Heading',
      text: publishableBlock.text,
      annotations,
    }
  }
  if (publishableBlock.type === 'Code') {
    return {
      ...base,
      type: 'Code',
      text: publishableBlock.text,
      annotations: [],
      attributes: {
        language: publishableBlock.language || '',
      },
    }
  }
  if (publishableBlock.type === 'Math') {
    return {
      ...base,
      type: 'Math',
      text: publishableBlock.text,
      annotations: [],
    }
  }
  if (publishableBlock.type === 'Image') {
    return {
      ...base,
      type: 'Image',
      text: '',
      link: publishableBlock.link,
      annotations: [],
      attributes: {
        width: publishableBlock.width,
        name: publishableBlock.name,
      },
    }
  }
  if (publishableBlock.type === 'Video') {
    return {
      ...base,
      type: 'Video',
      text: '',
      link: publishableBlock.link,
      annotations: [],
      attributes: {
        width: publishableBlock.width,
        name: publishableBlock.name,
      },
    }
  }
  if (publishableBlock.type === 'File') {
    return {
      ...base,
      type: 'File',
      text: '',
      link: publishableBlock.link,
      annotations: [],
      attributes: {
        size: publishableBlock.size,
        name: publishableBlock.name,
      },
    }
  }
  if (publishableBlock.type === 'Button') {
    return {
      ...base,
      type: 'Button',
      text: publishableBlock.text,
      link: publishableBlock.link,
      annotations: [],
      attributes: {
        alignment: publishableBlock.alignment,
      },
    }
  }
  if (publishableBlock.type === 'Embed') {
    return {
      ...base,
      type: 'Embed',
      text: '',
      link: publishableBlock.link,
      annotations: [],
      attributes: {
        view: publishableBlock.view,
      },
    }
  }

  throw new Error(`Unsupported block type: ${publishableBlock.type}`)
}
