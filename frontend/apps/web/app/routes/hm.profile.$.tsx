import {MyAccountBubble} from '@/account-bubble'
import {
  EditProfileDialog,
  LinkKeysDialog,
  LogoutButton,
  useLocalKeyPair,
} from '@/auth'
import {loadProfilePageData, ProfilePagePayload} from '@/loaders'
import {defaultPageMeta, defaultSiteIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {WebSiteHeader} from '@/web-site-header'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useAccount} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {HMProfilePage} from '@shm/ui/profile-page'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {KeySquare} from 'lucide-react'

const defaultProfileMeta = defaultPageMeta('Profile')

export const meta: MetaFunction = ({data}) => {
  const payload = unwrap<ProfilePagePayload>(data)
  if (!payload) return defaultProfileMeta()

  const meta: MetaDescriptor[] = []
  // Use origin site's home icon for favicon
  const homeIcon = payload.homeMetadata?.icon
    ? getOptimizedImageUrl(extractIpfsUrlCid(payload.homeMetadata.icon), 'S')
    : null
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })
  meta.push({
    title: payload.profileName || 'Profile',
  })
  return meta
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const uid = parsedRequest.pathParts[2]
  if (!uid) {
    throw new Response('Profile ID required', {status: 400})
  }
  const data = await loadProfilePageData(parsedRequest, uid)
  return wrapJSON(data)
}

function ProfilePageContent({
  homeMetadata,
  originHomeId,
  origin,
  profileId,
  currentAccount,
}: {
  homeMetadata: ProfilePagePayload['homeMetadata']
  originHomeId: UnpackedHypermediaId
  origin: string
  profileId: UnpackedHypermediaId
  currentAccount?: string
}) {
  const editProfileDialog = useAppDialog(EditProfileDialog)
  const account = useAccount(profileId.uid)
  const isCurrentAccount = currentAccount === profileId.uid
  const linkKeysDialog = useAppDialog(LinkKeysDialog)
  return (
    <>
      <div className="flex flex-col flex-1 items-center min-h-screen">
        <WebSiteHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          siteHomeId={originHomeId}
          docId={null}
          origin={origin}
        />
        <PageContainer>
          <HMProfilePage
            profile={{
              id: profileId,
              metadata: account.data?.metadata || null,
              hasSite: account.data?.hasSite,
            }}
            onEditProfile={() =>
              editProfileDialog.open({accountUid: profileId.uid})
            }
            currentAccount={currentAccount}
            headerButtons={
              isCurrentAccount ? (
                <>
                  <LogoutButton />
                  <Button
                    variant="outline"
                    onClick={() => linkKeysDialog.open({})}
                  >
                    <KeySquare className="size-4" />
                    Link Keys
                  </Button>
                </>
              ) : null
            }
          />
        </PageContainer>
        <MyAccountBubble />
        <PageFooter className="mt-auto w-full" hideDeviceLinkToast={true} />
        {linkKeysDialog.content}
        {editProfileDialog.content}
      </div>
    </>
  )
}
export default function ProfilePage() {
  const {originHomeId, origin, homeMetadata, profileId, dehydratedState} =
    unwrap<ProfilePagePayload>(useLoaderData())
  const userKeyPair = useLocalKeyPair()

  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      dehydratedState={dehydratedState}
    >
      <ProfilePageContent
        homeMetadata={homeMetadata}
        originHomeId={originHomeId}
        origin={origin}
        profileId={profileId}
        currentAccount={userKeyPair?.id}
      />
    </WebSiteProvider>
  )
}

const PageContainer = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col gap-5 items-center p-4 rounded-sm', className)}
    {...props}
  />
)
