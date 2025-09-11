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
import {Button} from '@shm/ui/button'

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
import {useAccount} from '@shm/shared/models/entity'
import {Comment, QuotedDocBlock} from '@shm/ui/comments'
import {BlocksContent} from '@shm/ui/document-content'
import {SmallSiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {useMutation} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import {useCallback, useMemo, useState} from 'react'

import {defaultSiteIcon} from '@/meta'
import {useTx} from '@shm/shared/translation'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {cn} from '@shm/ui/utils'
import {WebSigningProvider} from '@/web-signing-context'
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
      return await getMetadata(hmId(authorUid))
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
    ? await getMetadata(hmId(config.registeredAccountUid))
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
          author: await getMetadata(hmId(replyComment.author)),
        }
      : undefined,
    originHomeId: config?.registeredAccountUid
      ? hmId(config.registeredAccountUid)
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
    return <h2>Invalid target</h2>
  }
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  if (!originUrl) {
    return <h2>Invalid origin url</h2>
  }

  return (
    <WebSigningProvider enableWebSigning={enableWebSigning}>
      <div className="bg-panel flex h-screen w-screen flex-col">
        <WebSiteProvider
          origin={origin}
          originHomeId={originHomeId}
          siteHost={siteHost}
        >
          <ScrollArea>
            <div className="flex min-h-screen flex-1 flex-col items-center overflow-hidden pr-3 md:pr-0">
              {originHomeMetadata && (
                <SmallSiteHeader
                  originHomeMetadata={originHomeMetadata}
                  originHomeId={originHomeId}
                  siteHost={siteHost}
                />
              )}

              <div className="flex w-full max-w-2xl flex-1 flex-col gap-3 p-3 pt-4">
                <div className="py-4">
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
                      : tx(
                          'comment_on',
                          (args) => <>Comment on {args.target}</>,
                          {
                            target: (
                              <DocButtonLink
                                docId={targetId}
                                name={
                                  targetDocument.metadata.name ??
                                  'Untitled Document'
                                }
                              />
                            ),
                          },
                        )}
                  </SizableText>
                </div>
                {quotingBlockId ? (
                  <div className="py-4">
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
                  </div>
                ) : null}
                <div className="py-4">
                  {replyComment ? (
                    <>
                      <Comment
                        isLast={!publishedComment}
                        comment={replyComment.comment}
                        renderCommentContent={renderCommentContent}
                        authorMetadata={replyComment.author.metadata}
                      />
                    </>
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
                </div>
                <div className="py-4">
                  {publishedComment ? null : (
                    <WebCommenting
                      docId={targetId}
                      replyCommentId={replyCommentId || undefined}
                      replyCommentVersion={replyCommentVersion || undefined}
                      rootReplyCommentVersion={
                        rootReplyCommentVersion || undefined
                      }
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
                    <Button asChild variant="default">
                      <a
                        href={originUrl}
                      >{`Go back to ${originUrlUrl.hostname}`}</a>
                    </Button>
                  ) : null}
                </div>
                <PageFooter enableWebSigning={enableWebSigning} />
              </div>
            </div>
          </ScrollArea>
        </WebSiteProvider>
      </div>
    </WebSigningProvider>
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
    <a {...linkProps} className="white-space-wrap font-bold underline">
      {name}
    </a>
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
    <div
      className={cn(
        'border-border bg-background flex justify-between rounded-sm border p-2',
        error && 'border-red-600 bg-red-100',
      )}
    >
      <SizableText className="text-current">{statusText}</SizableText>
      {isLoading && <Spinner />}
      {retry && !isLoading ? (
        <Button onClick={retry} size="sm" variant="destructive">
          Retry
        </Button>
      ) : null}
    </div>
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
    const signerId = hmId(base58btc.encode(c.signer))
    return {
      c,
      signerId,
    }
  }, [comment])
  const author = useAccount(rawComment.signerId.uid)
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
      authorMetadata={author.data?.metadata ?? undefined}
    />
  )
}

function signedCommentToHMComment(
  id: string,
  signedComment: SignedComment,
): HMComment {
  // @ts-expect-error
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
