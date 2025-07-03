import {useFullRender} from '@/cache-policy'
import {DocumentPage, documentPageHeaders, documentPageMeta} from '@/document'
import {loadSiteResource, SiteDocumentPayload} from '@/loaders'
import {parseRequest} from '@/request'
import {unwrap} from '@/wrapping'
import {Params, useLoaderData} from '@remix-run/react'
import {hmId} from '@shm/shared'

export const meta = documentPageMeta

export const headers = documentPageHeaders

export const loader = async ({
  params,
  request,
}: {
  params: Params
  request: Request
}) => {
  const parsedRequest = parseRequest(request)
  if (!useFullRender(parsedRequest)) return null
  const {url, hostname, pathParts} = parsedRequest
  const version = url.searchParams.get('v')
  const commentTarget = url.searchParams.get('target')?.split('/')
  const targetDocUid = !!commentTarget?.[0] ? commentTarget?.[0] : undefined
  const targetDocPath = targetDocUid ? commentTarget?.slice(1) : undefined
  const latest = url.searchParams.get('l') === ''
  const id = produceHmId(pathParts, {
    version,
    latest,
    targetDocUid,
    targetDocPath,
  })
  return await loadSiteResource(parsedRequest, id, {
    prefersLanguages: parsedRequest.prefersLanguages,
  })
}

function produceHmId(
  pathParts: string[],
  options: {
    version?: string | null
    latest?: boolean
    targetDocUid?: string
    targetDocPath?: string[]
  },
) {
  return hmId(pathParts[1], {
    path: pathParts.slice(2),
    version: options.version,
    latest: options.latest,
    targetDocUid: options.targetDocUid,
  })
}

export default function HypermediaDocument() {
  const data = unwrap<SiteDocumentPayload>(useLoaderData())
  return <DocumentPage {...data} />
}
