import {useFullRender} from '@/cache-policy'
import {DocumentPage, documentPageHeaders, documentPageMeta} from '@/document'
import {loadComment, loadSiteDocument, SiteDocumentPayload} from '@/loaders'
import {parseRequest} from '@/request'
import {unwrap} from '@/wrapping'
import {Params, useLoaderData} from '@remix-run/react'
import {hmId, HMIDTypeSchema} from '@shm/shared'

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
  if (id.type === 'c') {
    const comment = await loadComment(id)
    const docId =
      id.targetDocUid &&
      hmId('d', id.targetDocUid, {
        path: id.targetDocPath,
      })
    if (!docId) throw new Error('Document not found')
    return await loadSiteDocument(parsedRequest, docId, {comment})
  }
  return await loadSiteDocument(parsedRequest, id)
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
  const typeParsed = HMIDTypeSchema.safeParse(pathParts[1])
  if (typeParsed.success) {
    return hmId(typeParsed.data, pathParts[2], {
      path: pathParts.slice(3),
      version: options.version,
      latest: options.latest,
      targetDocUid: options.targetDocUid,
      targetDocPath: options.targetDocPath,
    })
  }
  return hmId('d', pathParts[1], {
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
