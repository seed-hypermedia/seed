import {useLocalKeyPair} from '@/auth'
import {ClientOnly} from '@/client-lazy'
import type {SiteHeaderPayload} from '@/loaders'
import {PageFooter} from '@/page-footer'
import {NavigationLoadingContent, WebSiteProvider} from '@/providers'
import {WebSiteHeader} from '@/web-site-header'
import {useWebNotificationSigner} from '@/web-notifications'
import {WebHeaderActions} from '@/web-utils'
import {useIsSiteOwner} from '@shm/shared/models/capabilities'
import {getSiteEmailSubscribers, type NotificationSigner} from '@shm/shared/models/notification-service'
import {queryKeys} from '@shm/shared/models/query-keys'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {SiteEmailSubscribersPanel} from '@shm/ui/site-email-subscribers'
import {Spinner} from '@shm/ui/spinner'
import {useQuery} from '@tanstack/react-query'
import {Suspense} from 'react'

/** Loader payload for the email subscribers page, served at /:settings/email-subscribers. */
export type SiteSettingsEmailsPayload = SiteHeaderPayload & {
  kind: 'site-settings-emails'
  // The account whose subscribers are shown: the registered site account, or
  // the uid from the /hm/<uid>/:settings/email-subscribers gateway path.
  siteAccountUid: string | undefined
  // Matches the notifyServiceHost exposed by this site's /hm/api/config.
  notifyServiceHost: string | null
}

/** Full email subscribers page (site chrome + owner-gated list). */
export function SiteSettingsEmailsScreen({payload}: {payload: SiteSettingsEmailsPayload}) {
  const {originHomeId, siteHost, origin, homeMetadata, dehydratedState, siteAccountUid, notifyServiceHost} = payload
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider origin={origin} originHomeId={originHomeId} siteHost={siteHost} dehydratedState={dehydratedState}>
      <GeneralPageSurface className="min-h-screen items-center">
        <WebSiteHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          siteHomeId={originHomeId}
          docId={null}
          origin={origin}
          rightActions={<WebHeaderActions siteUid={originHomeId.uid} />}
        />
        <NavigationLoadingContent className="flex w-full flex-1 flex-col gap-4 pt-[var(--site-header-h)] sm:pt-0">
          <ClientOnly>
            <Suspense fallback={<Spinner />}>
              <WebSiteSettingsEmailsPage siteAccountUid={siteAccountUid} notifyServiceHost={notifyServiceHost} />
            </Suspense>
          </ClientOnly>
        </NavigationLoadingContent>
        <PageFooter className="w-full" />
      </GeneralPageSurface>
    </WebSiteProvider>
  )
}

/**
 * Client-only content for the email subscribers page. The list is fetched
 * from the site's notify service (the one exposed via /hm/api/config) with a
 * request signed by the web session key, delegated to the site account.
 */
export function WebSiteSettingsEmailsPage({
  siteAccountUid,
  notifyServiceHost,
}: {
  siteAccountUid: string | undefined
  notifyServiceHost: string | null
}) {
  const keyPair = useLocalKeyPair()
  const signer = useWebNotificationSigner()
  const {isSiteOwner, isLoading: isOwnershipLoading} = useIsSiteOwner(siteAccountUid)

  if (!siteAccountUid) {
    return <SiteEmailSubscribersPanel message="This site does not have a registered owner account." />
  }
  if (!notifyServiceHost) {
    return <SiteEmailSubscribersPanel message="This site does not have a notification service configured." />
  }
  if (!keyPair) {
    return <SiteEmailSubscribersPanel message="Sign in as the site owner to view email subscribers." />
  }
  if (isOwnershipLoading) {
    return <SiteEmailSubscribersPanel isLoading />
  }
  if (!isSiteOwner) {
    return <SiteEmailSubscribersPanel message="Only the site owner can view email subscribers." />
  }
  return <SiteEmailSubscribers notifyServiceHost={notifyServiceHost} siteAccountUid={siteAccountUid} signer={signer} />
}

function SiteEmailSubscribers({
  notifyServiceHost,
  siteAccountUid,
  signer,
}: {
  notifyServiceHost: string
  siteAccountUid: string
  signer: NotificationSigner | undefined
}) {
  // Ask for the SITE account's subscribers: the web session key signs the
  // request and the notify server verifies the AGENT capability chain from
  // the site account down to the session key.
  const siteSigner = signer ? {...signer, accountUid: siteAccountUid} : undefined
  const subscribers = useQuery({
    queryKey: [queryKeys.SITE_EMAIL_SUBSCRIBERS, notifyServiceHost, siteAccountUid],
    enabled: !!siteSigner,
    queryFn: () => getSiteEmailSubscribers(notifyServiceHost, siteSigner!),
  })

  return (
    <SiteEmailSubscribersPanel
      subscribers={subscribers.data?.subscribers}
      isLoading={!signer || subscribers.isLoading}
      errorMessage={subscribers.error instanceof Error ? subscribers.error.message : null}
    />
  )
}
