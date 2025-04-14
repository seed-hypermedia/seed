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
  // console.log('~~~ pathParts', pathParts)
  const version = url.searchParams.get('v')
  const commentTarget = url.searchParams.get('target')?.split('/')
  const targetDocUid = !!commentTarget?.[0] ? commentTarget?.[0] : undefined
  const targetDocPath = targetDocUid ? commentTarget?.slice(1) : undefined
  const latest = url.searchParams.get('l') === ''
  const [_hm, type, uid, ...restPath] = pathParts
  const id = hmId(HMIDTypeSchema.parse(type), uid, {
    path: restPath,
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
  // console.log('~~~ id', id)
  return await loadSiteDocument(parsedRequest, id)
}

export default function HypermediaDocument() {
  const data = unwrap<SiteDocumentPayload>(useLoaderData())
  console.log('~~~ data', data)
  return <DocumentPage {...data} />
}
