import {useUniversalAppContext} from '@shm/shared'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {loadShapeHomeStatus, type ShapeHomeStatus} from '@shm/shared/utils/shape-home'
import {useQuery} from '@tanstack/react-query'
import {useWebAccountUid} from '../web-notifications'
import {webUniversalClient} from '../universal-client'
import {getShapeHomeSiteRecord, useShapeHomeBrowserState} from './store'
import type {ShapeHomeSiteRecord} from '@shm/shared/models/shape-home-machines'

/** Result of the Shape Home eligibility gate for the current site. */
export interface WebShapeHomeGate {
  /** The site uid being evaluated, or null when not on a served site. */
  uid: string | null
  /** The Shape Home status (eligible, candidates), or null while loading. */
  status: ShapeHomeStatus | null
  /** The persisted record for this site, or undefined. */
  record: ShapeHomeSiteRecord | undefined
  /** Whether the one-time modal was already answered in this browser. */
  modalDone: boolean
  /** True only when all gating conditions hold (signed-in owner, siteUrl match, eligible, no record). */
  eligible: boolean
  /** True while the status query is loading. */
  loading: boolean
}

/** Fetches the Home document's metadata.siteUrl for the siteUrl origin check. */
async function fetchHomeSiteUrl(uid: string): Promise<string | null> {
  try {
    const homeId = hmId(uid)
    const resource = await webUniversalClient.request('Resource', {...homeId, version: null, latest: true})
    if (resource.type !== 'document') return null
    const siteUrl = (resource.document.metadata as any)?.siteUrl
    return typeof siteUrl === 'string' ? siteUrl : null
  } catch {
    return null
  }
}

function originMatches(siteUrl: string | null, locationOrigin: string): boolean {
  if (!siteUrl) return false
  try {
    return new URL(siteUrl).origin === locationOrigin
  } catch {
    return false
  }
}

/**
 * Whether this tab may run Shape my Home: it serves a site, the signed-in account owns it, the Home's
 * published siteUrl is this origin, the site is eligible, and this browser holds no record for it.
 */
export function isWebShapeHomeGateOpen(input: {
  uid: string | null
  accountUid: string | undefined
  siteUrl: string | null
  locationOrigin: string
  status: ShapeHomeStatus | null
  record: ShapeHomeSiteRecord | undefined
}): boolean {
  return (
    input.uid !== null &&
    input.accountUid === input.uid &&
    originMatches(input.siteUrl, input.locationOrigin) &&
    !!input.status?.eligible &&
    input.record === undefined
  )
}

/**
 * Shape Home eligibility gate for web. Returns the site uid, status, record, and
 * whether all gating conditions hold. Eligibility is fetched once via react-query
 * (`queryKey: ['shape-home-status', uid]`).
 */
export function useWebShapeHomeGate(): WebShapeHomeGate {
  const {originHomeId} = useUniversalAppContext()
  const accountUid = useWebAccountUid()
  const locationOrigin = typeof window !== 'undefined' ? window.location.origin : ''

  const uid = originHomeId?.uid ?? null
  const signedInOwner = uid !== null && accountUid === uid

  const statusQuery = useQuery({
    queryKey: ['shape-home-status', uid ?? ''],
    queryFn: () => loadShapeHomeStatus(webUniversalClient, uid!),
    enabled: uid !== null && signedInOwner,
  })

  const siteUrlQuery = useQuery({
    queryKey: ['shape-home-site-url', uid ?? ''],
    queryFn: () => fetchHomeSiteUrl(uid!),
    enabled: uid !== null && signedInOwner,
  })

  const browserState = useShapeHomeBrowserState()
  const record = uid ? getShapeHomeSiteRecord(browserState, uid) : undefined

  const status = statusQuery.data ?? null
  const eligible = isWebShapeHomeGateOpen({
    uid,
    accountUid,
    siteUrl: siteUrlQuery.data ?? null,
    locationOrigin,
    status,
    record,
  })

  return {
    uid,
    status,
    record,
    modalDone: !!browserState.modalDone,
    eligible,
    loading: statusQuery.isLoading || siteUrlQuery.isLoading,
  }
}
