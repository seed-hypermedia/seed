import {MainWrapper} from '@/components/main-wrapper'
import {useSelectedAccount} from '@/selected-account'
import {ActivityProvider} from '@shm/shared/activity-service-provider'
import {useResolvedResource} from '@shm/shared/models/entity'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {PanelContainer} from '@shm/ui/container'
import {HMProfilePage} from '@shm/ui/profile-page'
import {useMemo} from 'react'
import {DesktopActivityService} from '../desktop-activity-service'
import {AppBlocksContentProvider} from './document-content-provider'

export default function ProfilePage() {
  const route = useNavRoute()
  const profileRoute = route.key === 'profile' ? route : null
  const profileId = profileRoute!.id
  const profile = useResolvedResource(profileId)
  const doc = profile.data?.type === 'document' ? profile.data.document : null
  const activityService = useMemo(() => new DesktopActivityService(), [])
  const selectedAccount = useSelectedAccount()

  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <ActivityProvider service={activityService}>
          <AppBlocksContentProvider
            docId={profileId}
            comment
            textUnit={16}
            layoutUnit={18}
          >
            <HMProfilePage
              profile={{id: profileId, metadata: doc?.metadata ?? null}}
              currentAccount={selectedAccount?.id.uid ?? ''}
              onEditProfile={null}
            />
          </AppBlocksContentProvider>
        </ActivityProvider>
      </MainWrapper>
    </PanelContainer>
  )
}
