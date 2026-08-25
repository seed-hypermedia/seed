import {MainWrapper} from '@/components/main-wrapper'
import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {useIsSpaceOwner} from '@shm/shared/models/capabilities'
import {useAccount} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {PanelContainer} from '@shm/ui/container'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {SpaceEmailSubscribersPanel} from '@shm/ui/space-email-subscribers'
import {useQuery} from '@tanstack/react-query'
import {ReactNode} from 'react'

/**
 * Space owner's email subscribers page. The list lives on the notify service
 * that the space advertises via its /hm/api/config, so the request goes
 * through the main process which resolves that host and signs with the
 * selected identity's key, delegated to the space account.
 */
export default function SpaceSettingsEmailsPage() {
  const route = useNavRoute()
  const routeAccountUid = route.key === 'space-settings-emails' ? route.accountUid : undefined
  const selectedAccountUid = useSelectedAccountId()
  const spaceAccountUid = routeAccountUid ?? selectedAccountUid ?? undefined
  const {isSpaceOwner, isLoading: isOwnershipLoading} = useIsSpaceOwner(spaceAccountUid)
  const account = useAccount(spaceAccountUid)
  const siteUrl: string | undefined = account.data?.metadata?.siteUrl

  let content: ReactNode
  if (!selectedAccountUid || !spaceAccountUid) {
    content = <SpaceEmailSubscribersPanel message="Select an account to view its email subscribers." />
  } else if (isOwnershipLoading || account.isLoading) {
    content = <SpaceEmailSubscribersPanel isLoading />
  } else if (!isSpaceOwner) {
    content = (
      <SpaceEmailSubscribersPanel message="Only the space owner can view email subscribers. Switch to the space's account to see this list." />
    )
  } else {
    content = <SpaceEmailSubscribers siteUrl={siteUrl} spaceAccountUid={spaceAccountUid} signAs={selectedAccountUid} />
  }

  return (
    <PanelContainer className="dark:bg-background bg-white">
      <MainWrapper scrollable>
        <GeneralPageSurface>{content}</GeneralPageSurface>
      </MainWrapper>
    </PanelContainer>
  )
}

function SpaceEmailSubscribers({
  siteUrl,
  spaceAccountUid,
  signAs,
}: {
  siteUrl: string | undefined
  spaceAccountUid: string
  signAs: string
}) {
  const subscribers = useQuery({
    queryKey: [queryKeys.SPACE_EMAIL_SUBSCRIBERS, siteUrl ?? null, spaceAccountUid, signAs],
    queryFn: () => client.spaces.getEmailSubscribers.query({siteUrl, accountUid: spaceAccountUid, signAs}),
  })

  return (
    <SpaceEmailSubscribersPanel
      subscribers={subscribers.data?.subscribers}
      isLoading={subscribers.isLoading}
      errorMessage={subscribers.error instanceof Error ? subscribers.error.message : null}
    />
  )
}
