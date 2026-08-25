import {normalizeAgentServerUrl} from '@shm/ui/agents/client'
import {resolveHypermediaUrl, type ResolveOptions} from '@seed-hypermedia/client'
import {agentRouteSchema, createDocumentNavRoute, createInspectNavRoute, type NavRoute} from '@shm/shared/routes'
import {
  activitySlugToFilter,
  extractViewTermFromUrl,
  isSpaceProfileTab,
  routeToHmUrl,
  viewTermToRouteKey,
} from '@shm/shared/utils/entity-id-url'
import {appRouteOfId} from '@shm/shared/utils/navigation'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'

function getUrlHostname(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

/**
 * Returns the current space's custom domain only when it is actively resolving
 * to the same account as the page shown in the desktop omnibar.
 */
export function selectValidatedOmnibarSpaceUrl(params: {
  candidateSpaceUrl?: string | null
  gatewayUrl: string
  accountUid?: string | null
  registeredAccountUid?: string | null
  domainStatus?: string | null
  isDomainLoading?: boolean
}): string | null {
  const candidateHostname = getUrlHostname(params.candidateSpaceUrl)
  const gatewayHostname = getUrlHostname(params.gatewayUrl)

  if (!params.candidateSpaceUrl || !candidateHostname) return null
  if (gatewayHostname && candidateHostname === gatewayHostname) return null

  // Domain check still in flight — optimistically show what the user typed.
  if (params.isDomainLoading) return params.candidateSpaceUrl

  // Domain check did not succeed (error, unreachable, unknown, or query
  // returned null). Keep showing the candidate — we only rewrite to gateway
  // when the check *successfully* resolves to the wrong account.
  if (params.domainStatus !== 'success') return params.candidateSpaceUrl

  // Domain check succeeded. Verify the account matches.
  if (!params.accountUid || !params.registeredAccountUid) return null
  if (params.registeredAccountUid !== params.accountUid) return null

  return params.candidateSpaceUrl
}

/**
 * Resolves a URL using the same routing rules as the desktop omnibar.
 */
export async function resolveOmnibarUrlToRoute(url: string, opts?: ResolveOptions): Promise<NavRoute | null> {
  const spaceSettingsEmailsRoute = await spaceSettingsEmailsUrlToRoute(url, opts)
  if (spaceSettingsEmailsRoute) return spaceSettingsEmailsRoute

  const directRoute = hypermediaUrlToRoute(url)
  if (directRoute) return directRoute

  const agentRoute = agentUrlToRoute(url)
  if (agentRoute) return agentRoute

  const {url: cleanUrl, isInspect, viewTerm, activityFilter, commentId, accountUid} = extractViewTermFromUrl(url)
  const routeKey = viewTermToRouteKey(viewTerm)

  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    return null
  }

  try {
    const result = await resolveHypermediaUrl(cleanUrl, opts)
    if (!result?.hmId) return null

    const baseRoute = result.panel ? createDocumentNavRoute(result.hmId, null, result.panel) : appRouteOfId(result.hmId)
    if (!baseRoute) return null

    return applyResolvedViewTerm(baseRoute, routeKey, activityFilter, commentId, accountUid, isInspect)
  } catch {
    return null
  }
}

/**
 * Resolves a URL using omnibar routing rules and returns the hm:// URL form.
 */
export async function resolveOmnibarUrlToHypermediaUrl(url: string, opts?: ResolveOptions): Promise<string | null> {
  const route = await resolveOmnibarUrlToRoute(url, opts)
  if (!route) return null
  return routeToHmUrl(route)
}

type AgentTab = NonNullable<Extract<NavRoute, {key: 'agent'}>['tab']>

// Derived from the route schema so a tab added there is representable in agent URLs
// without anyone remembering this file exists.
const AGENT_TABS = agentRouteSchema.shape.tab.unwrap().options

export function agentUrl(serverUrl: string, agentId: string, tab?: AgentTab, memoryPath?: string): string {
  const base = `${normalizeAgentServerUrl(serverUrl)}/agents/${encodeURIComponent(agentId)}`
  // Sessions is the default tab, so its URL is the bare agent URL.
  if (!tab || tab === 'sessions') return base
  if (tab === 'memory' && memoryPath) {
    const filePath = memoryPath.split('/').map(encodeURIComponent).join('/')
    return `${base}/:memory/${filePath}`
  }
  return `${base}/:${tab}`
}

export function agentSessionUrl(serverUrl: string, agentId: string, sessionId: string): string {
  return `${agentUrl(serverUrl, agentId)}/sessions/${encodeURIComponent(sessionId)}`
}

export function agentTriggerUrl(serverUrl: string, agentId: string, triggerId: string): string {
  return `${agentUrl(serverUrl, agentId)}/:triggers/${encodeURIComponent(triggerId)}`
}

/**
 * Resolves <siteUrl>/:settings/email-subscribers (or the gateway form
 * <gatewayUrl>/hm/<uid>/:settings/email-subscribers) to the
 * space-settings-emails route.
 */
async function spaceSettingsEmailsUrlToRoute(input: string, opts?: ResolveOptions): Promise<NavRoute | null> {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (
      segments.length === 4 &&
      segments[0] === 'hm' &&
      segments[2] === ':settings' &&
      segments[3] === 'email-subscribers'
    ) {
      return {key: 'space-settings-emails', accountUid: segments[1]}
    }
    if (segments.length !== 2 || segments[0] !== ':settings' || segments[1] !== 'email-subscribers') return null
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    const result = await resolveHypermediaUrl(url.toString(), opts)
    if (!result?.hmId) return null
    return {key: 'space-settings-emails', accountUid: result.hmId.uid}
  } catch {
    return null
  }
}

export function agentUrlToRoute(input: string): NavRoute | null {
  try {
    const url = new URL(input.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (segments[0] !== 'agents') return null
    if (segments.length === 1) {
      url.pathname = '/'
      url.search = ''
      url.hash = ''
      return {key: 'agent-server', serverUrl: normalizeAgentServerUrl(url.toString())}
    }
    const agentId = segments[1]
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    const serverUrl = normalizeAgentServerUrl(url.toString())
    if (segments.length === 2) return {key: 'agent', serverUrl, agentId}
    if (segments.length === 4 && segments[2] === 'sessions') {
      return {key: 'agent-session', serverUrl, agentId, sessionId: segments[3]}
    }
    // Legacy trigger URL form, before triggers moved to the /:triggers tab suffix.
    if (segments.length === 4 && segments[2] === 'triggers') {
      return {key: 'agent', serverUrl, agentId, tab: 'triggers', triggerId: segments[3]}
    }
    if (segments[2]?.startsWith(':')) {
      const tab = AGENT_TABS.find((candidate) => candidate === segments[2].slice(1))
      if (!tab) return null
      const rest = segments.slice(3)
      if (tab === 'memory' && rest.length) {
        return {key: 'agent', serverUrl, agentId, tab, memoryPath: rest.join('/')}
      }
      if (tab === 'triggers' && rest.length === 1) {
        return {key: 'agent', serverUrl, agentId, tab, triggerId: rest[0]}
      }
      if (rest.length === 0) return {key: 'agent', serverUrl, agentId, tab}
      return null
    }
    return null
  } catch {
    return null
  }
}

function applyResolvedViewTerm(
  route: NavRoute,
  routeKey: ReturnType<typeof viewTermToRouteKey>,
  activityFilter?: string,
  commentId?: string,
  accountUid?: string,
  isInspect?: boolean,
): NavRoute {
  if (route.key !== 'document') return route

  if (isInspect) {
    return createInspectNavRoute(
      route.id,
      routeKey,
      routeKey === 'activity' && activityFilter ? `activity/${activityFilter}` : null,
      commentId,
      accountUid,
    )
  }

  if (!routeKey) return route

  if (routeKey === 'comments' && commentId) {
    // On comment permalinks, ?v pins the comment version, not the document version
    return {
      key: 'comments',
      id: {...route.id, version: null, latest: true},
      openComment: commentId,
      openCommentVersion: route.id.version || undefined,
    }
  }

  if (isSpaceProfileTab(routeKey)) {
    return {key: 'space-profile', id: route.id, accountUid: accountUid || undefined, tab: routeKey}
  }

  if (routeKey === 'activity') {
    return {
      key: 'activity',
      id: route.id,
      filterEventType: activityFilter ? activitySlugToFilter(activityFilter) : undefined,
    }
  }

  if (routeKey === 'explore') {
    return {key: 'explore', context: {type: 'space', id: route.id}}
  }

  return {key: routeKey, id: route.id}
}
