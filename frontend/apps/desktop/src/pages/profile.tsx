import { MainWrapper } from '@/components/main-wrapper'
import { useSelectedAccount } from '@/selected-account'
import { useNavigate } from '@/utils/useNavigate'
import { useAccount, useResource } from '@shm/shared/models/entity'
import { useNavRoute } from '@shm/shared/utils/navigation'
import { AccountPage } from '@shm/ui/account-page'
import { PanelContainer } from '@shm/ui/container'
import { toast } from '@shm/ui/toast'
import { useEffect } from 'react'

export default function ProfilePage() {
  const route = useNavRoute()
  const profileRoute = route.key === 'profile' ? route : null
  const profileId = profileRoute!.id
  const profile = useAccount(profileId.uid)
  const selectedAccount = useSelectedAccount()
  const navigate = useNavigate('replace')
  const redirectDestination = profile.data?.id.uid && profile.data.id.uid !== profileId.uid ? profile.data.id : null
  useEffect(() => {
    // todo, make this actually make sense.
    if (redirectDestination) {
      toast('This account redirects to another account.')
      navigate({key: 'profile', id: redirectDestination})
    }
  }, [redirectDestination])
  useResource(profileId, {subscribed: true, recursive: true})

  if (!profileRoute) throw new Error('Profile route not found')

  return (
    <PanelContainer>
      <MainWrapper scrollable className="w-full">
        {profile.data && (
          <AccountPage accountUid={profile.data.id.uid} tab={profileRoute.tab || "profile"} />
        )}
      </MainWrapper>
    </PanelContainer>
  )
}
