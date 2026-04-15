import {useEditProfileDialog} from '@/components/edit-profile-dialog'
import {MainWrapper} from '@/components/main-wrapper'
import {useMyAccountIds} from '@/models/daemon'
import {useNavigate} from '@/utils/useNavigate'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {AccountPage} from '@shm/ui/account-page'
import {PanelContainer} from '@shm/ui/container'
import {PageDiscovery, PageNotFound} from '@shm/ui/page-message-states'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useEffect, useMemo} from 'react'

export default function ProfilePage() {
  const route = useNavRoute()
  const profileRoute = route.key === 'profile' ? route : null
  const profileId = profileRoute!.id
  const profile = useAccount(profileId.uid)
  const resource = useResource(profileId, {subscribed: true, recursive: true})
  const navigate = useNavigate('replace')
  const redirectDestination = profile.data?.id.uid && profile.data.id.uid !== profileId.uid ? profile.data.id : null
  useEffect(() => {
    // todo, make this actually make sense.
    if (redirectDestination) {
      toast('This account redirects to another account.')
      navigate({key: 'profile', id: redirectDestination})
    }
  }, [redirectDestination])

  const myAccountIds = useMyAccountIds()
  const editProfileDialog = useEditProfileDialog()
  const accountUid = profile.data?.id.uid
  const isOwnAccount = !!accountUid && !!myAccountIds.data?.includes(accountUid)
  const onEditProfile = useMemo(() => {
    if (!isOwnAccount || !accountUid) return undefined
    return () => editProfileDialog.open({accountUid})
  }, [isOwnAccount, accountUid, editProfileDialog])

  if (!profileRoute) throw new Error('Profile route not found')

  if (resource.isInitialLoading) {
    return (
      <PanelContainer>
        <MainWrapper scrollable className="w-full">
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        </MainWrapper>
      </PanelContainer>
    )
  }

  if (resource.isDiscovering) {
    return (
      <PanelContainer>
        <MainWrapper scrollable className="w-full">
          <PageDiscovery entityType="profile" />
        </MainWrapper>
      </PanelContainer>
    )
  }

  if (profile.isLoading) {
    return (
      <PanelContainer>
        <MainWrapper scrollable className="w-full">
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        </MainWrapper>
      </PanelContainer>
    )
  }

  if (!profile.data) {
    return (
      <PanelContainer>
        <MainWrapper scrollable className="w-full">
          <PageNotFound entityType="profile" />
        </MainWrapper>
      </PanelContainer>
    )
  }

  return (
    <PanelContainer>
      <MainWrapper scrollable className="w-full">
        <AccountPage
          accountUid={profile.data.id.uid}
          tab={profileRoute.tab || 'profile'}
          onEditProfile={onEditProfile}
        />
      </MainWrapper>
      {editProfileDialog.content}
    </PanelContainer>
  )
}
