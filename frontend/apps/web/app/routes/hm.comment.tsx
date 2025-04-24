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
import {WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap, wrapJSON} from '@/wrapping'
import {LoaderFunctionArgs} from '@remix-run/node'
import {useLoaderData, useSearchParams} from '@remix-run/react'
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
} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {Comment} from '@shm/ui/discussion'
import {BlocksContent} from '@shm/ui/document-content'
import {NewspaperCard} from '@shm/ui/newspaper'
import {Heading} from '@tamagui/text'
import {useMutation} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import {useCallback, useMemo, useState} from 'react'
import {Button, SizableText, Spinner, View, XStack, YStack} from 'tamagui'
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
        replyCommentId: string
        rootReplyCommentId: string
      }
    | undefined
} & ReturnType<typeof getOriginRequestData>

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const config = await getConfig(parsedRequest.hostname)
  const targetStr = parsedRequest.searchParams.get('target')
  const replyCommentId = parsedRequest.searchParams.get('reply')
  const rootReplyCommentId = parsedRequest.searchParams.get('rootReply')
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
          replyCommentId: replyComment.id,
          rootReplyCommentId: rootReplyCommentId ?? '',
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
  } = unwrap<CommentPagePayload>(useLoaderData())

  const [params] = useSearchParams()
  const originUrl = params.get('originUrl') || undefined
  const originUrlUrl = originUrl ? new URL(originUrl) : undefined
  const replyCommentId = params.get('reply')
  const rootReplyCommentId = params.get('rootReply')

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
        <YStack flex={1} gap="$3" maxWidth={500} paddingTop="$4">
          <NewspaperCard
            id={targetId}
            entity={{
              id: targetId,
              document: targetDocument,
            }}
            accountsMetadata={targetAuthors}
          />
          {publishedComment ? (
            <>
              <SyncCommentFeedback
                isLoading={syncComment.isLoading}
                hostname={originUrlUrl?.hostname ?? ''}
                error={syncComment.error?.message}
                retry={retry}
              />
              <PublishedComment
                commentId={publishedComment.id}
                siteHost={siteHost}
                comment={publishedComment.raw}
                targetId={targetId}
                rootReplyCommentId={rootReplyCommentId}
                enableWebSigning={enableWebSigning}
                originHomeId={originHomeId}
              />
            </>
          ) : null}
          {/* EXPANDING SPACE GOES HERE */}
          <View f={1} />
          {publishedComment ? null : (
            <WebCommenting
              docId={targetId}
              replyCommentId={replyCommentId}
              rootReplyCommentId={rootReplyCommentId}
              enableWebSigning={enableWebSigning}
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
          <PageFooter enableWebSigning={enableWebSigning} />
        </YStack>
      </YStack>
    </WebSiteProvider>
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
      <SizableText color={borderColor}>{statusText}</SizableText>
      {isLoading && <Spinner />}
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
  rootReplyCommentId,
  enableWebSigning,
  originHomeId,
  siteHost,
}: {
  commentId: string
  comment: CommentPayload
  targetId: UnpackedHypermediaId
  rootReplyCommentId: string | null
  enableWebSigning: boolean
  originHomeId: UnpackedHypermediaId
  siteHost: string
}) {
  const rawComment = useMemo(() => {
    const c = cborDecode<SignedComment>(comment.comment)
    const signerId = hmId('d', base58btc.encode(c.signer))
    return {
      c,
      signerId,
    }
  }, [comment])
  console.log('rawComment', rawComment)
  const author = useEntity(rawComment.signerId)
  console.log('author', author.data)
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
      docId={targetId}
      rootReplyCommentId={rootReplyCommentId}
      renderCommentContent={renderCommentContent}
      enableWebSigning={enableWebSigning}
      CommentReplies={() => null}
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
