import {MainWrapper} from '@/components/main-wrapper'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {PanelContainer} from '@shm/ui/container'
import {HMProfilePage} from '@shm/ui/profile-page'
import {toast} from '@shm/ui/toast'
import {useEffect} from 'react'

export default function ProfilePage() {
  const route = useNavRoute()
  const profileRoute = route.key === 'profile' ? route : null
  const profileId = profileRoute!.id
  const profile = useAccount(profileId.uid)
  const selectedAccount = useSelectedAccount()
  const navigate = useNavigate('replace')
  const redirectDestination =
    profile.data?.id.uid && profile.data.id.uid !== profileId.uid
      ? profile.data.id
      : null
  useEffect(() => {
    // todo, make this actually make sense.
    if (redirectDestination) {
      toast('This account redirects to another account.')
      navigate({key: 'profile', id: redirectDestination})
    }
  }, [redirectDestination])
  useResource(profileId, {subscribed: true, recursive: true})

  return (
    <PanelContainer>
      <MainWrapper scrollable>
        {profile.data && (
          <HMProfilePage
            profile={profile.data}
            currentAccount={selectedAccount?.id.uid ?? ''}
            onEditProfile={null}
          />
        )}
      </MainWrapper>
    </PanelContainer>
  )
}
