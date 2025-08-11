import {useFullRender} from '@/cache-policy'
import {
  links as documentLinks,
  DocumentPage,
  documentPageHeaders,
  documentPageMeta,
} from '@/document'
import {loadSiteResource, SiteDocumentPayload} from '@/loaders'
import {defaultPageMeta} from '@/meta'
import {NoSitePage, NotRegisteredPage} from '@/not-registered'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap, wrapJSON} from '@/wrapping'
import {MetaFunction, Params, useLoaderData} from '@remix-run/react'
import {hmId} from '@shm/shared'

type DocumentPayload = SiteDocumentPayload | 'unregistered' | 'no-site'

const unregisteredMeta = defaultPageMeta('Welcome to Seed Hypermedia')

export const links = () => [...documentLinks()]

export const meta: MetaFunction<typeof loader> = (args) => {
  const payload = unwrap<DocumentPayload>(args.data)
  if (payload === 'unregistered') return unregisteredMeta()
  if (payload === 'no-site') return unregisteredMeta()
  return documentPageMeta({
    data: args.data,
  })
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
  const serviceConfig = await getConfig(hostname)
  if (!serviceConfig) return wrapJSON('no-site', {status: 404})
  const {registeredAccountUid} = serviceConfig
  if (!registeredAccountUid) return wrapJSON('unregistered', {status: 404})

  let documentId

  // Determine document type based on URL pattern
  if (pathParts[0] === 'hm' && pathParts.length > 1) {
    // Hypermedia document (/hm/uid/path...)
    documentId = hmId(pathParts[1], {
      path: pathParts.slice(2),
      version,
      latest,
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
  const unwrappedData = useLoaderData()
  const data = unwrap<DocumentPayload>(unwrappedData)
  if (data === 'unregistered') {
    return <NotRegisteredPage />
  }
  if (data === 'no-site') {
    return <NoSitePage />
  }

  return <DocumentPage {...data} />
}
