import {useFullRender} from '@/cache-policy'
import {DocumentPage, documentPageHeaders, documentPageMeta} from '@/document'
import {loadSiteResource, SiteDocumentPayload} from '@/loaders'
import {defaultPageMeta} from '@/meta'
import {NoSitePage, NotRegisteredPage} from '@/not-registered'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap, wrapJSON} from '@/wrapping'
import {Params, useLoaderData} from '@remix-run/react'
import {hmId} from '@shm/shared'

type DocumentPayload = SiteDocumentPayload | 'unregistered' | 'no-site'

const unregisteredMeta = defaultPageMeta('Welcome to Seed Hypermedia')

export const meta: typeof documentPageMeta = (args) => {
  const payload = unwrap<DocumentPayload>(args.data)
  if (payload === 'unregistered') return unregisteredMeta()
  if (payload === 'no-site') return unregisteredMeta()
  return documentPageMeta(args)
}

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
  const latest = url.searchParams.get('l') === ''
  console.log('~~ url', url)
  const serviceConfig = await getConfig(hostname)
  if (!serviceConfig) return wrapJSON('no-site', {status: 404})
  const {registeredAccountUid} = serviceConfig
  if (!registeredAccountUid) return wrapJSON('unregistered', {status: 404})

  let documentId

  // Determine document type based on URL pattern
  if (pathParts[0] === 'hm' && pathParts.length > 1) {
    // Hypermedia document (/hm/uid/path...)
    const commentTarget = url.searchParams.get('target')?.split('/')
    const targetDocUid = !!commentTarget?.[0] ? commentTarget?.[0] : undefined
    const targetDocPath = targetDocUid ? commentTarget?.slice(1) : undefined

    documentId = hmId(pathParts[1], {
      path: pathParts.slice(2),
      version,
      latest,
      targetDocUid,
    })
  } else {
    // Site document (regular path)
    const path = params['*'] ? params['*'].split('/').filter(Boolean) : []
    documentId = hmId(registeredAccountUid, {path, version, latest})
  }

  return await loadSiteResource(parsedRequest, documentId, {
    prefersLanguages: parsedRequest.prefersLanguages,
  })
}

export default function UnifiedDocumentPage() {
  const data = unwrap<DocumentPayload>(useLoaderData())
  if (data === 'unregistered') {
    return <NotRegisteredPage />
  }
  if (data === 'no-site') {
    return <NoSitePage />
  }

  return <DocumentPage {...data} />
}
