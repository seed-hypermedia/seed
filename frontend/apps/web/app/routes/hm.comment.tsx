import {cborDecode} from '@/api'
import {WebCommenting} from '@/client-lazy'
import {WebDocContentProvider} from '@/doc-content-provider'
import {getHMDocument, getMetadata, getOriginRequestData} from '@/loaders'
import {PageFooter} from '@/page-footer'
import {WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap, wrapJSON} from '@/wrapping'
import {LoaderFunctionArgs} from '@remix-run/node'
import {useLoaderData, useSearchParams} from '@remix-run/react'
import {
  HMAccountsMetadata,
  HMComment,
  HMDocument,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {Comment} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {NewspaperCard} from '@shm/ui/newspaper'
import {Heading} from '@tamagui/text'
import {useMutation} from '@tanstack/react-query'
import {useCallback, useState} from 'react'
import {Button, Spinner, View, YStack} from 'tamagui'
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
} & ReturnType<typeof getOriginRequestData>

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const config = await getConfig(parsedRequest.hostname)
  const targetStr = parsedRequest.searchParams.get('target')
  const targetVersion = parsedRequest.searchParams.get('targetVersion')
  const targetIdBare = targetStr ? unpackHmId(`hm://${targetStr}`) : undefined
  const targetId = targetIdBare
    ? {
        ...targetIdBare,
        version: targetVersion,
      }
    : undefined
  const targetDocument = targetId && (await getHMDocument(targetId))
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
  return wrapJSON({
    targetAuthors: Object.fromEntries(
      targetAuthors.map((author) => [author.id.uid, author]),
    ),
    targetDocument,
    targetId,
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
  } = unwrap<CommentPagePayload>(useLoaderData())

  const [params] = useSearchParams()
  const originUrl = params.get('originUrl') || undefined
  const originUrlUrl = originUrl ? new URL(originUrl) : undefined
  const replyCommentId = params.get('reply')
  const rootReplyCommentId = params.get('rootReply')

  const syncComment = useMutation({
    mutationFn: async (req: SyncCommentRequest) => {
      if (!originUrlUrl) throw new Error('')
      const resp = await fetch(`${originUrlUrl.origin}/hm/api/sync-comment`, {
        method: 'POST',
        body: JSON.stringify(req),
      })
      return resp.json()
    },
  })
  const [publishedComment, setPublishedComment] =
    useState<CommentPayload | null>(null)

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
      <YStack flex={1}>
        <NewspaperCard
          id={targetId}
          entity={{
            id: targetId,
            document: targetDocument,
          }}
          accountsMetadata={targetAuthors}
        />
        <View f={1} />
        {publishedComment ? (
          <PublishedComment
            siteHost={siteHost}
            comment={publishedComment}
            targetId={targetId}
            rootReplyCommentId={rootReplyCommentId}
            enableWebSigning={enableWebSigning}
            originHomeId={originHomeId}
          />
        ) : (
          <WebCommenting
            docId={targetId}
            replyCommentId={replyCommentId}
            rootReplyCommentId={rootReplyCommentId}
            enableWebSigning={enableWebSigning}
            commentingOriginUrl={originUrl}
            onSuccess={(result) => {
              if (originUrl) {
                setPublishedComment(result.commentPayload)
                syncComment.mutate({
                  commentId: result.response.commentId,
                  target: targetId.id,
                  dependencies: result.response.dependencies,
                })
              }
            }}
          />
        )}
        {syncComment.isLoading && <Spinner />}
        {syncComment.isSuccess && originUrlUrl && (
          <Heading>Synced to {originUrlUrl.hostname}</Heading>
        )}
        {syncComment.isSuccess && originUrlUrl ? (
          <Button
            backgroundColor="$brand5"
            hoverStyle={{backgroundColor: '$brand4'}}
            focusStyle={{backgroundColor: '$brand4'}}
            tag="a"
            href={originUrl}
          >
            Go to {originUrlUrl.hostname}
          </Button>
        ) : null}
      </YStack>
      <PageFooter enableWebSigning={enableWebSigning} />
    </WebSiteProvider>
  )
}

function PublishedComment({
  comment,
  targetId,
  rootReplyCommentId,
  enableWebSigning,
  originHomeId,
  siteHost,
}: {
  comment: CommentPayload
  targetId: UnpackedHypermediaId
  rootReplyCommentId: string | null
  enableWebSigning: boolean
  originHomeId: UnpackedHypermediaId
  siteHost: string
}) {
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
  const foo = cborDecode<HMComment>(comment.comment)
  return (
    <Comment
      comment={foo}
      docId={targetId}
      rootReplyCommentId={rootReplyCommentId}
      renderCommentContent={renderCommentContent}
      enableWebSigning={enableWebSigning}
      CommentReplies={() => null}
    />
  )
}
