import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {MouseEvent, MouseEventHandler} from 'react'
import {useCallback} from 'react'
import {IS_DESKTOP} from './constants'
import {useAccount, useDomain} from './models/entity'
import type {NavRoute} from './routes'
import {useRouteLink, useUniversalAppContext} from './routing'
import {hmId, routeToUrl, unpackHmId} from './utils/entity-id-url'
import {hypermediaUrlToRoute} from './utils/url-to-route'

const DOMAIN_LINK_STALE_TIME_MS = 3 * 60 * 60 * 1000

type ValidatedRouteLinkOpts = {
  replace?: boolean
  onClick?: MouseEventHandler<HTMLElement>
  origin?: string | null
  originHomeId?: UnpackedHypermediaId
}

type ParsedSeedLink = {
  externalHref?: string
  fallbackTarget: NavRoute | string | null
  fallbackOpts?: ValidatedRouteLinkOpts
  expectedAccountUid?: string | null
  isSeedLink: boolean
  routeForExternal?: NavRoute | null
  explicitOrigin?: string | null
}

function getHostname(input?: string | null): string | null {
  if (!input) return null
  try {
    return new URL(input).hostname || null
  } catch {
    return null
  }
}

function getOrigin(input?: string | null): string | null {
  if (!input) return null
  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.origin || null
  } catch {
    return null
  }
}

function getExpectedAccountUid(route: NavRoute | null): string | null {
  if (!route) return null
  if (!('id' in route) || !route.id || typeof route.id !== 'object') return null
  return 'uid' in route.id && typeof route.id.uid === 'string' ? route.id.uid : null
}

function getParseableHref(route: string): string {
  if (typeof window !== 'undefined' && route.startsWith('/')) {
    return new URL(route, window.location.origin).toString()
  }
  return route
}

function parseSeedLink(
  route: NavRoute | string | null,
  opts: ValidatedRouteLinkOpts | undefined,
  originHomeId: UnpackedHypermediaId | undefined,
): ParsedSeedLink {
  if (!route) {
    return {
      fallbackTarget: null,
      fallbackOpts: opts,
      isSeedLink: false,
    }
  }

  if (typeof route !== 'string') {
    const expectedAccountUid = getExpectedAccountUid(route)
    const hostname = getHostname(opts?.origin)
    const externalHref =
      opts?.origin && expectedAccountUid ? routeToUrl(route, {hostname: opts.origin, originHomeId}) : undefined

    return {
      externalHref,
      fallbackTarget: route,
      fallbackOpts: externalHref ? {...opts, origin: undefined} : opts,
      expectedAccountUid,
      isSeedLink: !!expectedAccountUid,
      routeForExternal: route,
      explicitOrigin: hostname ? opts?.origin || null : null,
    }
  }

  const parseableHref = getParseableHref(route)
  const unpackedId = unpackHmId(parseableHref)
  const parsedRoute = hypermediaUrlToRoute(parseableHref) || (unpackedId ? {key: 'document', id: unpackedId} : null)

  if (!parsedRoute) {
    return {
      fallbackTarget: route,
      fallbackOpts: opts,
      isSeedLink: false,
      routeForExternal: null,
      explicitOrigin: null,
    }
  }

  return {
    externalHref: route.startsWith('http://') || route.startsWith('https://') ? route : undefined,
    fallbackTarget: parsedRoute,
    fallbackOpts: opts,
    expectedAccountUid: unpackedId?.uid || getExpectedAccountUid(parsedRoute),
    isSeedLink: true,
    routeForExternal: parsedRoute,
    explicitOrigin: unpackedId?.hostname ? `${unpackedId.scheme}://${unpackedId.hostname}` : getOrigin(route),
  }
}

/**
 * Chooses whether a Seed destination should keep its external hostname or fall
 * back to a same-domain href while verification is missing, stale, or invalid.
 */
export function getValidatedWebSeedLinkState(params: {
  href?: string | null
  fallbackHref?: string | null
  hostname?: string | null
  expectedAccountUid?: string | null
  registeredAccountUid?: string | null
  isDomainLoading?: boolean
  isSeedLink?: boolean
  isDesktop?: boolean
}) {
  const href = params.href ?? undefined
  const fallbackHref = params.fallbackHref ?? href ?? undefined

  if (
    params.isDesktop ||
    !params.isSeedLink ||
    !href ||
    !fallbackHref ||
    !params.hostname ||
    !params.expectedAccountUid
  ) {
    return {
      kind: 'passthrough' as const,
      href,
    }
  }

  if (
    !params.isDomainLoading &&
    params.registeredAccountUid &&
    params.registeredAccountUid === params.expectedAccountUid
  ) {
    return {
      kind: 'verified' as const,
      href,
    }
  }

  return {
    kind: 'fallback' as const,
    href: fallbackHref,
  }
}

/**
 * Returns link props that keep Seed links on the current web domain unless the
 * destination hostname is verified for the target site/account.
 */
export function useValidatedWebRouteLink(route: NavRoute | string | null, opts?: ValidatedRouteLinkOpts) {
  const context = useUniversalAppContext()
  const originHomeId = opts?.originHomeId || context.originHomeId
  const parsedSeedLink = parseSeedLink(route, opts, originHomeId)
  const internalLinkProps = useRouteLink(parsedSeedLink.fallbackTarget, parsedSeedLink.fallbackOpts)
  const targetAccount = useAccount(parsedSeedLink.expectedAccountUid, {
    enabled: !IS_DESKTOP && !parsedSeedLink.explicitOrigin && !!parsedSeedLink.expectedAccountUid,
  })
  const candidateOrigin = parsedSeedLink.explicitOrigin || targetAccount.data?.metadata?.siteUrl || null
  const candidateHostname = getHostname(candidateOrigin)
  const candidateExternalHref =
    candidateOrigin && parsedSeedLink.routeForExternal && parsedSeedLink.expectedAccountUid
      ? routeToUrl(parsedSeedLink.routeForExternal, {
          hostname: candidateOrigin,
          originHomeId: hmId(parsedSeedLink.expectedAccountUid),
        })
      : parsedSeedLink.externalHref
  const domainInfo = useDomain(candidateHostname, {
    enabled: !IS_DESKTOP && !!candidateHostname && !!parsedSeedLink.expectedAccountUid,
    forceCheck: true,
    retry: false,
    staleTime: DOMAIN_LINK_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })

  const linkState = getValidatedWebSeedLinkState({
    href: candidateExternalHref,
    fallbackHref: internalLinkProps.href,
    hostname: candidateHostname,
    expectedAccountUid: parsedSeedLink.expectedAccountUid,
    registeredAccountUid: domainInfo.data?.registeredAccountUid,
    isDomainLoading: domainInfo.isLoading,
    isSeedLink: parsedSeedLink.isSeedLink,
    isDesktop: IS_DESKTOP,
  })

  const verifiedOnClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation()
      opts?.onClick?.(event)
      if (event.defaultPrevented) return
      if (
        !candidateExternalHref ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      event.preventDefault()
      if (typeof window !== 'undefined') {
        window.location.assign(candidateExternalHref)
      } else {
        context.openUrl(candidateExternalHref)
      }
    },
    [candidateExternalHref, context, opts],
  )

  if (linkState.kind === 'verified' && candidateExternalHref) {
    return {
      href: linkState.href || candidateExternalHref,
      tag: 'a' as const,
      onClick: verifiedOnClick,
      isSeedLink: true,
      validationKind: linkState.kind,
    }
  }

  return {
    ...internalLinkProps,
    href: linkState.href || internalLinkProps.href,
    isSeedLink: parsedSeedLink.isSeedLink,
    validationKind: linkState.kind,
  }
}
