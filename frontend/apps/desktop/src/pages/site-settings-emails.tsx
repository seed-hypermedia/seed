import {MainWrapper} from '@/components/main-wrapper'
import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {useIsSiteOwner} from '@shm/shared/models/capabilities'
import {useAccount} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {PanelContainer} from '@shm/ui/container'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {SiteEmailSubscribersPanel} from '@shm/ui/site-email-subscribers'
import {useQuery} from '@tanstack/react-query'
import {ReactNode} from 'react'

/**
 * Site owner's email subscribers page. The list lives on the notify service
 * that the site advertises via its /hm/api/config, so the request goes
 * through the main process which resolves that host and signs with the
 * selected identity's key, delegated to the site account.
 */
export default function SiteSettingsEmailsPage() {
  const route = useNavRoute()
  const routeAccountUid = route.key === 'site-settings-emails' ? route.accountUid : undefined
  const selectedAccountUid = useSelectedAccountId()
  const siteAccountUid = routeAccountUid ?? selectedAccountUid ?? undefined
  const {isSiteOwner, isLoading: isOwnershipLoading} = useIsSiteOwner(siteAccountUid)
  const account = useAccount(siteAccountUid)
  const siteUrl: string | undefined = account.data?.metadata?.siteUrl

  let content: ReactNode
  if (!selectedAccountUid || !siteAccountUid) {
    content = <SiteEmailSubscribersPanel message="Select an account to view its email subscribers." />
  } else if (isOwnershipLoading || account.isLoading) {
    content = <SiteEmailSubscribersPanel isLoading />
  } else if (!isSiteOwner) {
    content = (
      <SiteEmailSubscribersPanel message="Only the site owner can view email subscribers. Switch to the site's account to see this list." />
    )
  } else {
    content = <SiteEmailSubscribers siteUrl={siteUrl} siteAccountUid={siteAccountUid} signAs={selectedAccountUid} />
  }

  return (
    <PanelContainer className="dark:bg-background bg-white">
      <MainWrapper scrollable>
        <GeneralPageSurface>{content}</GeneralPageSurface>
      </MainWrapper>
    </PanelContainer>
  )
}

function SiteEmailSubscribers({
  siteUrl,
  siteAccountUid,
  signAs,
}: {
  siteUrl: string | undefined
  siteAccountUid: string
  signAs: string
}) {
  const subscribers = useQuery({
    queryKey: [queryKeys.SITE_EMAIL_SUBSCRIBERS, siteUrl ?? null, siteAccountUid, signAs],
    queryFn: () => client.sites.getEmailSubscribers.query({siteUrl, accountUid: siteAccountUid, signAs}),
  })

  return (
    <SiteEmailSubscribersPanel
      subscribers={subscribers.data?.subscribers}
      isLoading={subscribers.isLoading}
      errorMessage={subscribers.error instanceof Error ? subscribers.error.message : null}
    />
  )
}
