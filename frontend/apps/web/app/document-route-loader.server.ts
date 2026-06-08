import {
  createInstrumentationContext,
  instrument,
  printInstrumentationSummary,
  setRequestInstrumentationContext,
} from '@/instrumentation.server'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {shouldBypassServerDocumentFetchForWebDraftPath} from '@/document-edit/web-draft-path'
import {
  extractInspectIpfsPathFromPath,
  extractInspectPrefixFromPath,
  extractViewTermFromPath,
} from '@/document-route-path'
import {loadSiteResource, loadWebDraftPlaceholderResource, type SiteDocumentPayload} from '@/loaders'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import {wrapJSON} from '@/wrapping.server'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, type InspectTab, type ViewRouteKey} from '@shm/shared'

/** Extended site payload returned by the main web document route loader. */
export type ExtendedSitePayload = SiteDocumentPayload & {
  isInspect?: boolean
  viewTerm?: ViewRouteKey | null
  panelParam?: string | null
  openComment?: string | null
  accountUid?: string | null
  inspectTab?: InspectTab | null
}

/** Payload returned when the main route renders the IPFS inspector. */
export type InspectIpfsPayload = {
  kind: 'inspect-ipfs'
  ipfsPath: string
  originHomeId: UnpackedHypermediaId
  siteHost: string
}

/** All payload variants returned by the main web document route loader. */
export type DocumentPayload = ExtendedSitePayload | InspectIpfsPayload | 'unregistered' | 'no-site'

/** Minimal route params needed by the main document route loader. */
export type DocumentRouteParams = {
  '*'?: string
}

/** Runs the document route loader with the daemon auth context installed. */
export async function loadDocumentRouteWithAuth({params, request}: {params: DocumentRouteParams; request: Request}) {
  const authToken = await getDaemonAuthToken(request)
  return withDaemonAuthToken(authToken, () => loadDocumentRoute({params, request}))
}

/** Framework-neutral implementation of the main web document route loader. */
export async function loadDocumentRoute({params, request}: {params: DocumentRouteParams; request: Request}) {
  const parsedRequest = parseRequest(request)
  const ctx = createInstrumentationContext(parsedRequest.url.pathname, request.method)

  // Check if this is a data request (client-side navigation) vs document request (full page).
  // Remix single fetch normalizes URLs, so check sec-fetch-mode header.
  const isDataRequest = request.headers.get('Sec-Fetch-Mode') === 'cors'

  // Store context for SSR phase access (will be retrieved in entry.server.tsx).
  // Only needed for document requests that will go through SSR.
  if (!isDataRequest) {
    setRequestInstrumentationContext(request.url, ctx)
  }

  const {url, hostname, pathParts} = parsedRequest
  const version = url.searchParams.get('v')
  const latest = url.searchParams.get('l') === '' || !version
  const panelParam = url.searchParams.get('panel')
  const inspectTab = url.searchParams.get('tab')

  const serviceConfig = await instrument(ctx, 'getConfig', () => getConfig(hostname))
  if (!serviceConfig) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON('no-site', {status: 404})
  }
  const {registeredAccountUid} = serviceConfig
  if (!registeredAccountUid) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON('unregistered', {status: 404})
  }

  const gatewayInspectIpfsPath = pathParts[0] === 'hm' ? extractInspectIpfsPathFromPath(pathParts, true) : null
  const siteInspectIpfsPath = gatewayInspectIpfsPath ? null : extractInspectIpfsPathFromPath(pathParts, false)
  const inspectIpfsPath = gatewayInspectIpfsPath || siteInspectIpfsPath
  if (inspectIpfsPath) {
    if (isDataRequest && ctx.enabled) {
      printInstrumentationSummary(ctx)
    }
    return wrapJSON({
      kind: 'inspect-ipfs',
      ipfsPath: inspectIpfsPath,
      originHomeId: hmId(registeredAccountUid),
      siteHost: hostname,
    } satisfies InspectIpfsPayload)
  }

  let documentId
  let isInspect = false
  let viewTerm: ViewRouteKey | null = null
  // Merge activity filter slug from path into panelParam for createDocumentNavRoute.
  let effectivePanelParam = panelParam
  let openComment: string | null = null
  let accountUid: string | null = null

  // Determine document type based on URL pattern.
  if (pathParts[0] === 'hm' && pathParts.length > 1) {
    // Hypermedia document (/hm/uid/path...) or inspector document (/hm/inspect/uid/path...).
    const inspectResult = extractInspectPrefixFromPath(pathParts, true)
    isInspect = inspectResult.isInspect
    const targetPathParts = inspectResult.pathParts
    const docUid = targetPathParts[0]
    const extracted = extractViewTermFromPath(targetPathParts.slice(1))
    viewTerm = extracted.viewTerm
    if (extracted.activityFilter) {
      effectivePanelParam = `activity/${extracted.activityFilter}`
    }
    if (extracted.commentId) {
      openComment = extracted.commentId
    }
    accountUid = extracted.accountUid || null
    documentId = hmId(docUid, {
      path: extracted.path,
      version,
      latest,
    })
  } else {
    // Site document (regular path) or inspector document (/inspect/path...).
    const rawPath = params['*'] ? params['*'].split('/').filter(Boolean) : []
    const inspectResult = extractInspectPrefixFromPath(rawPath, false)
    isInspect = inspectResult.isInspect
    const extracted = extractViewTermFromPath(inspectResult.pathParts)
    viewTerm = extracted.viewTerm
    if (extracted.activityFilter) {
      effectivePanelParam = `activity/${extracted.activityFilter}`
    }
    if (extracted.commentId) {
      openComment = extracted.commentId
    }
    accountUid = extracted.accountUid || null
    documentId = hmId(registeredAccountUid, {
      path: extracted.path,
      version,
      latest,
    })
  }

  const siteResourceData = {
    prefersLanguages: parsedRequest.prefersLanguages,
    viewTerm,
    panelParam: effectivePanelParam,
    openComment,
    accountUid,
    isInspect,
    inspectTab: isInspect && inspectTab ? (inspectTab as ExtendedSitePayload['inspectTab']) : null,
    instrumentationCtx: ctx,
  }

  const shouldLoadLocalDraftShell = shouldBypassServerDocumentFetchForWebDraftPath({
    path: documentId.path,
    isInspect,
    version,
  })

  const result = await instrument(
    ctx,
    shouldLoadLocalDraftShell ? 'loadWebDraftPlaceholderResource' : 'loadSiteResource',
    () =>
      shouldLoadLocalDraftShell
        ? loadWebDraftPlaceholderResource(parsedRequest, documentId, siteResourceData)
        : loadSiteResource(parsedRequest, documentId, siteResourceData),
  )

  // For data requests (client-side nav), print summary here since there's no SSR phase.
  if (isDataRequest && ctx.enabled) {
    printInstrumentationSummary(ctx)
  }

  return result
}
