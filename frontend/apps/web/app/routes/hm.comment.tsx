import {WebCommenting} from '@/client-lazy'
import {PageFooter} from '@/page-footer'
import {parseRequest} from '@/request'
import {LoaderFunctionArgs} from '@remix-run/node'
import {json, useLoaderData, useSearchParams} from '@remix-run/react'
import {unpackHmId} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {Container} from '@shm/ui/container'
import {NewspaperCard} from '@shm/ui/newspaper'
import {Heading} from '@tamagui/text'
import {YStack} from 'tamagui'

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const enableWebSigning = true // todo, combine with other loader
  return json({enableWebSigning})
}

export default function CreateComment() {
  const {enableWebSigning} = useLoaderData<typeof loader>()
  const [params] = useSearchParams()
  const originUrl = params.get('originUrl') || undefined
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

  const entity = useEntity(targetDocId)
  if (!targetDocId) {
    return <Heading>Invalid target</Heading>
  }
  return (
    <Container>
      <YStack flex={1}>
        <Heading>Create Comment</Heading>
        {entity.data && (
          <NewspaperCard
            id={targetDocId}
            entity={entity.data}
            accountsMetadata={{}}
          />
        )}
        {/* <SizableText>{params.get('target')}</SizableText> */}
        <WebCommenting
          docId={targetDocId}
          replyCommentId={replyCommentId}
          rootReplyCommentId={rootReplyCommentId}
          enableWebSigning={enableWebSigning}
          commentingOriginUrl={originUrl}
        />
      </YStack>
      <PageFooter enableWebSigning={enableWebSigning} />
    </Container>
  )
}
