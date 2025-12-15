import {MyAccountBubble} from '@/account-bubble'
import {
  EditProfileDialog,
  LinkKeysDialog,
  LogoutButton,
  useLocalKeyPair,
} from '@/auth'
import {getMetadata, loadSiteHeaderData, SiteHeaderPayload} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {WebSiteHeader} from '@/web-site-header'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {hmId} from '@shm/shared'
import {HMMetadataPayload, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useAccount} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {HMProfilePage} from '@shm/ui/profile-page'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {KeySquare} from 'lucide-react'

type ProfilePagePayload = SiteHeaderPayload & {
  profile: HMMetadataPayload
}

export const meta: MetaFunction = ({data}) => {
  const {homeMetadata, profile} = unwrap<ProfilePagePayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIcon = homeMetadata?.icon
    ? getOptimizedImageUrl(extractIpfsUrlCid(homeMetadata.icon), 'S')
    : null
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })
  meta.push({
    title: profile.metadata?.name || 'Profile',
  })
  return meta
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const headerData = await loadSiteHeaderData(parsedRequest)

  const uid = parsedRequest.pathParts[2]
  const profile = await getMetadata(hmId(uid))

  return wrapJSON({
    ...headerData,
    profile,
  } satisfies ProfilePagePayload)
}

function ProfilePageContent({
  homeMetadata,
  originHomeId,
  origin,
  profile,
  currentAccount,
}: {
  homeMetadata: ProfilePagePayload['homeMetadata']
  originHomeId: UnpackedHypermediaId
  origin: string
  profile: HMMetadataPayload
  currentAccount?: string
}) {
  const editProfileDialog = useAppDialog(EditProfileDialog)
  const account = useAccount(profile.id.uid)
  const displayMetadata = account.data?.metadata ?? profile.metadata
  const isCurrentAccount = currentAccount === profile.id.uid
  const linkKeysDialog = useAppDialog(LinkKeysDialog)
  return (
    <>
      <div className="flex min-h-screen flex-1 flex-col items-center">
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
              id: profile.id,
              metadata: displayMetadata,
              hasSite: profile.hasSite,
            }}
            onEditProfile={() =>
              editProfileDialog.open({accountUid: profile.id.uid})
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
  const {
    originHomeId,
    siteHost,
    origin,
    homeMetadata,
    profile,
    dehydratedState,
  } = unwrap<ProfilePagePayload>(useLoaderData())
  const userKeyPair = useLocalKeyPair()

  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
      dehydratedState={dehydratedState}
    >
      <ProfilePageContent
        homeMetadata={homeMetadata}
        originHomeId={originHomeId}
        origin={origin}
        profile={profile}
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
    className={cn('flex flex-col items-center gap-5 rounded-sm p-4', className)}
    {...props}
  />
)
