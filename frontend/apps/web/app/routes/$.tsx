import {useFullRender} from '@/cache-policy'
import {
  links as documentLinks,
  DocumentPage,
  documentPageHeaders,
  documentPageMeta,
} from '@/document'
import {GRPCError, loadSiteResource, SiteDocumentPayload} from '@/loaders'
import {defaultPageMeta} from '@/meta'
import {NoSitePage, NotRegisteredPage} from '@/not-registered'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap, wrapJSON} from '@/wrapping'
import {Code} from '@connectrpc/connect'
import {MetaFunction, Params} from 'react-router'
import {useLoaderData} from 'react-router-dom'
import {hmId} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {SizableText} from '@shm/ui/text'

type DocumentPayload = SiteDocumentPayload | 'unregistered' | 'no-site'

const unregisteredMeta = defaultPageMeta('Welcome to Seed Hypermedia')

export const links = () => [...documentLinks()]

export const meta: MetaFunction<typeof loader> = (args) => {
  const payload = unwrap<DocumentPayload>(args.data)
  if (payload === 'unregistered') return unregisteredMeta()
  if (payload === 'no-site') return unregisteredMeta()
  return documentPageMeta({
    // @ts-expect-error
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

  // The not found error is handled by the DocumentPage component,
  // and here we handle the rest of the errors.
  if (data.daemonError && data.daemonError.code !== Code.NotFound) {
    return (
      <DaemonErrorPage
        message={data.daemonError.message}
        code={data.daemonError.code}
      />
    )
  }

  return <DocumentPage {...data} />
}

export function DaemonErrorPage(props: GRPCError) {
  const tx = useTx()
  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="border-border dark:bg-background flex w-full max-w-2xl flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
          <SizableText size="3xl">☹️</SizableText>
          <SizableText size="2xl" weight="bold">
            {props.code === Code.Unavailable
              ? tx('Internal Server Error')
              : tx('Server Error')}
          </SizableText>

          {props.code === Code.Unavailable ? (
            <SizableText>
              {tx(
                'error_no_daemon_connection',
                `No connection to the backend daemon server. It's probably a bug in our software. Please let us know!`,
              )}
            </SizableText>
          ) : null}

          <pre className="text-destructive wrap-break-word whitespace-pre-wrap">
            {props.message}
          </pre>
        </div>
      </div>
    </div>
  )
}
