import {WebCommenting} from '@/client-lazy'
import {parseRequest} from '@/request'
import {LoaderFunctionArgs} from '@remix-run/node'
import {json, useLoaderData, useSearchParams} from '@remix-run/react'
import {unpackHmId} from '@shm/shared'
import {YStack} from '@tamagui/stacks'
import {Heading, SizableText} from '@tamagui/text'

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const enableWebSigning = true // todo, combine with other loader
  return json({enableWebSigning})
}

export default function CreateComment() {
  const {enableWebSigning} = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const targetStr = params.get('target')
  const targetVersion = params.get('targetVersion')
  const targetDocIdBare = targetStr
    ? unpackHmId(`hm://${targetStr}`)
    : undefined
  const targetDocId = targetDocIdBare
    ? {
        ...targetDocIdBare,
        version: targetVersion,
      }
    : undefined
  const replyCommentId = params.get('reply')
  const rootReplyCommentId = params.get('rootReply')
  console.log({replyCommentId, rootReplyCommentId, targetDocId})
  if (!targetDocId) {
    return <Heading>Invalid target</Heading>
  }
  return (
    <YStack>
      <Heading>Create Comment</Heading>
      <SizableText>{params.get('target')}</SizableText>
      <WebCommenting
        docId={targetDocId}
        replyCommentId={replyCommentId}
        rootReplyCommentId={rootReplyCommentId}
        enableWebSigning={enableWebSigning}
      />
    </YStack>
  )
}
