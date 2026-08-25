import {useLocalKeyPair} from '@/auth'
import {ClientOnly} from '@/client-lazy'
import type {SpaceHeaderPayload} from '@/loaders'
import {PageFooter} from '@/page-footer'
import {NavigationLoadingContent, WebSpaceProvider} from '@/providers'
import {WebSpaceHeader} from '@/web-space-header'
import {useWebNotificationSigner} from '@/web-notifications'
import {WebHeaderActions} from '@/web-utils'
import {useIsSpaceOwner} from '@shm/shared/models/capabilities'
import {getSpaceEmailSubscribers, type NotificationSigner} from '@shm/shared/models/notification-service'
import {queryKeys} from '@shm/shared/models/query-keys'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {SpaceEmailSubscribersPanel} from '@shm/ui/space-email-subscribers'
import {Spinner} from '@shm/ui/spinner'
import {useQuery} from '@tanstack/react-query'
import {Suspense} from 'react'

/** Loader payload for the email subscribers page, served at /:settings/email-subscribers. */
export type SpaceSettingsEmailsPayload = SpaceHeaderPayload & {
  kind: 'space-settings-emails'
  // The account whose subscribers are shown: the registered space account, or
  // the uid from the /hm/<uid>/:settings/email-subscribers gateway path.
  spaceAccountUid: string | undefined
  // Matches the notifyServiceHost exposed by this space's /hm/api/config.
  notifyServiceHost: string | null
}

/** Full email subscribers page (space chrome + owner-gated list). */
export function SpaceSettingsEmailsScreen({payload}: {payload: SpaceSettingsEmailsPayload}) {
  const {originHomeId, spaceHost, origin, homeMetadata, dehydratedState, spaceAccountUid, notifyServiceHost} = payload
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSpaceProvider
      origin={origin}
      originHomeId={originHomeId}
      spaceHost={spaceHost}
      dehydratedState={dehydratedState}
    >
      <GeneralPageSurface className="min-h-screen items-center">
        <WebSpaceHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          spaceHomeId={originHomeId}
          docId={null}
          origin={origin}
          rightActions={<WebHeaderActions spaceUid={originHomeId.uid} />}
        />
        <NavigationLoadingContent className="flex w-full flex-1 flex-col gap-4 pt-[var(--space-header-h)] sm:pt-0">
          <ClientOnly>
            <Suspense fallback={<Spinner />}>
              <WebSpaceSettingsEmailsPage spaceAccountUid={spaceAccountUid} notifyServiceHost={notifyServiceHost} />
            </Suspense>
          </ClientOnly>
        </NavigationLoadingContent>
        <PageFooter className="w-full" />
      </GeneralPageSurface>
    </WebSpaceProvider>
  )
}

/**
 * Client-only content for the email subscribers page. The list is fetched
 * from the space's notify service (the one exposed via /hm/api/config) with a
 * request signed by the web session key, delegated to the space account.
 */
export function WebSpaceSettingsEmailsPage({
  spaceAccountUid,
  notifyServiceHost,
}: {
  spaceAccountUid: string | undefined
  notifyServiceHost: string | null
}) {
  const keyPair = useLocalKeyPair()
  const signer = useWebNotificationSigner()
  const {isSpaceOwner, isLoading: isOwnershipLoading} = useIsSpaceOwner(spaceAccountUid)

  if (!spaceAccountUid) {
    return <SpaceEmailSubscribersPanel message="This space does not have a registered owner account." />
  }
  if (!notifyServiceHost) {
    return <SpaceEmailSubscribersPanel message="This space does not have a notification service configured." />
  }
  if (!keyPair) {
    return <SpaceEmailSubscribersPanel message="Sign in as the space owner to view email subscribers." />
  }
  if (isOwnershipLoading) {
    return <SpaceEmailSubscribersPanel isLoading />
  }
  if (!isSpaceOwner) {
    return <SpaceEmailSubscribersPanel message="Only the space owner can view email subscribers." />
  }
  return (
    <SpaceEmailSubscribers notifyServiceHost={notifyServiceHost} spaceAccountUid={spaceAccountUid} signer={signer} />
  )
}

function SpaceEmailSubscribers({
  notifyServiceHost,
  spaceAccountUid,
  signer,
}: {
  notifyServiceHost: string
  spaceAccountUid: string
  signer: NotificationSigner | undefined
}) {
  // Ask for the SPACE account's subscribers: the web session key signs the
  // request and the notify server verifies the AGENT capability chain from
  // the space account down to the session key.
  const spaceSigner = signer ? {...signer, accountUid: spaceAccountUid} : undefined
  const subscribers = useQuery({
    queryKey: [queryKeys.SPACE_EMAIL_SUBSCRIBERS, notifyServiceHost, spaceAccountUid],
    enabled: !!spaceSigner,
    queryFn: () => getSpaceEmailSubscribers(notifyServiceHost, spaceSigner!),
  })

  return (
    <SpaceEmailSubscribersPanel
      subscribers={subscribers.data?.subscribers}
      isLoading={!signer || subscribers.isLoading}
      errorMessage={subscribers.error instanceof Error ? subscribers.error.message : null}
    />
  )
}
