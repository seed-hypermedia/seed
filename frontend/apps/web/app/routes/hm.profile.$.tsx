import {MyAccountBubble} from '@/account-bubble'
import {
  EditProfileDialog,
  LinkKeysDialog,
  LogoutButton,
  useLocalKeyPair,
} from '@/auth'
import {WebDocContentProvider} from '@/doc-content-provider'
import {getMetadata, getOriginRequestData} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import {WebActivityService} from '@/web-activity-service'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {LoaderFunctionArgs, MetaFunction} from 'react-router'
import {MetaDescriptor, useLoaderData} from 'react-router'
import {hmId} from '@shm/shared'
import {ActivityProvider} from '@shm/shared/activity-service-provider'
import {
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useAccount} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {HMProfilePage} from '@shm/ui/profile-page'
import {SmallSiteHeader} from '@shm/ui/site-header'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {KeySquare} from 'lucide-react'
import {useMemo} from 'react'

type ProfilePagePayload = {
  originHomeId: UnpackedHypermediaId | undefined
  originHomeMetadata: HMMetadata | undefined
  origin: string
  profile: HMMetadataPayload
} & ReturnType<typeof getOriginRequestData>

export const meta: MetaFunction = ({data}) => {
  const {originHomeMetadata, profile} = unwrap<ProfilePagePayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIcon = originHomeMetadata?.icon
    ? getOptimizedImageUrl(extractIpfsUrlCid(originHomeMetadata.icon), 'S')
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
  const config = await getConfig(parsedRequest.hostname)

  const originHome = config?.registeredAccountUid
    ? await getMetadata(hmId(config.registeredAccountUid))
    : undefined
  const uid = parsedRequest.pathParts[2]
  const profile = await getMetadata(hmId(uid))
  return wrapJSON({
    originHomeId: config?.registeredAccountUid
      ? hmId(config.registeredAccountUid)
      : undefined,
    ...getOriginRequestData(parsedRequest),
    originHomeMetadata: originHome?.metadata ?? undefined,
    profile,
  } satisfies ProfilePagePayload)
}

function ProfilePageContent({
  originHomeMetadata,
  originHomeId,
  siteHost,
  profile,
  currentAccount,
}: {
  originHomeMetadata: HMMetadata | undefined
  originHomeId: UnpackedHypermediaId
  siteHost: string
  profile: HMMetadataPayload
  currentAccount?: string
}) {
  const activityService = useMemo(() => new WebActivityService(), [])
  const editProfileDialog = useAppDialog(EditProfileDialog)
  const account = useAccount(profile.id.uid)
  const displayMetadata = account.data?.metadata ?? profile.metadata
  const isCurrentAccount = currentAccount === profile.id.uid
  const linkKeysDialog = useAppDialog(LinkKeysDialog)
  return (
    <>
      <div className="flex min-h-screen flex-1 flex-col items-center">
        {originHomeMetadata && (
          <SmallSiteHeader
            originHomeMetadata={originHomeMetadata}
            originHomeId={originHomeId}
            siteHost={siteHost}
          />
        )}
        <PageContainer>
          <ActivityProvider service={activityService}>
            <WebDocContentProvider
              siteHost={siteHost}
              originHomeId={originHomeId}
              comment
              textUnit={16}
              layoutUnit={18}
            >
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
            </WebDocContentProvider>
          </ActivityProvider>
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
  const {originHomeId, siteHost, origin, originHomeMetadata, profile} =
    unwrap<ProfilePagePayload>(useLoaderData())
  const userKeyPair = useLocalKeyPair()

  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
    >
      <ProfilePageContent
        originHomeMetadata={originHomeMetadata}
        originHomeId={originHomeId}
        siteHost={siteHost}
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
