import {useLocalKeyPair} from '@/auth'
import {getMetadata, getOriginRequestData} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {injectModels} from '@/models'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import * as cbor from '@ipld/dag-cbor'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {
  DeviceLinkSessionSchema,
  hmId,
  useRouteLink,
  useUniversalAppContext,
} from '@shm/shared'
import {
  DeviceLinkSession,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {Button} from '@shm/ui/button'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {SmallSiteHeader} from '@shm/ui/site-header'
import {Text} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {ArrowRight, Check} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useState} from 'react'
import {postCBOR} from '../api'
import {createAccount, LocalWebIdentity, logout} from '../auth'
import {linkDevice, LinkingEvent, LinkingResult} from '../device-linking'
import type {DelegateDevicePayload} from './hm.api.delegate-device'

injectModels()
// export async function loader({request}: LoaderFunctionArgs) {
//   const parsedRequest = parseRequest(request)
//   const code = parsedRequest.pathParts[2]
//   console.log('code', code)
//   return
// }

type DeviceLinkPagePayload = {
  enableWebSigning: boolean
  originHomeId: UnpackedHypermediaId | undefined
  originHomeMetadata: HMMetadata | undefined
  origin: string
} & ReturnType<typeof getOriginRequestData>

export const meta: MetaFunction = ({data}) => {
  const {originHomeMetadata} = unwrap<DeviceLinkPagePayload>(data)
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
    title: 'Link Seed Hypermedia Device',
  })
  return meta
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const config = await getConfig(parsedRequest.hostname)

  const originHome = config?.registeredAccountUid
    ? await getMetadata(hmId(config.registeredAccountUid))
    : undefined
  return wrapJSON({
    originHomeId: config?.registeredAccountUid
      ? hmId(config.registeredAccountUid)
      : undefined,
    ...getOriginRequestData(parsedRequest),
    originHomeMetadata: originHome?.metadata ?? undefined,
  } satisfies DeviceLinkPagePayload)
}

export default function DeviceLinkPage() {
  const {originHomeId, siteHost, origin, originHomeMetadata} =
    unwrap<DeviceLinkPagePayload>(useLoaderData())
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
    >
      <div className="flex min-h-screen flex-1 flex-col items-center">
        {originHomeMetadata && (
          <SmallSiteHeader
            originHomeMetadata={originHomeMetadata}
            originHomeId={originHomeId}
            siteHost={siteHost}
          />
        )}
        <div className="w-full max-w-2xl flex-1 gap-3 px-0 pt-4">
          <div className="px-4">
            <HMDeviceLink />
          </div>
        </div>
        <PageFooter />
      </div>
    </WebSiteProvider>
  )
}

const DeviceLinkContainer = ({className, ...props}: any) => (
  <div
    className={cn(
      'flex flex-col items-center gap-5 rounded-sm bg-white p-4',
      className,
    )}
    {...props}
  />
)

async function storeDeviceDelegation(payload: DelegateDevicePayload) {
  const result = await postCBOR('/hm/api/delegate-device', cbor.encode(payload))
  console.log('delegateDevice result', result)
}

type LinkingState =
  | null
  | {
      state: 'result'
      result: LinkingResult
    }
  | {
      state: 'event'
      event: LinkingEvent
    }
  | {
      state: 'error'
      error: string
    }

export function useLinkDevice(
  localIdentity: LocalWebIdentity | null,
  setLinkingState: (state: LinkingState) => void = () => {},
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (session: DeviceLinkSession) => {
      let didCreateAccount = false
      if (!localIdentity) {
        // this should be all we need, but instead we have to create a full profile for some reason
        // await generateAndStoreKeyPair()
        localIdentity = await createAccount({
          name: `Web Key of ${session.accountId}`,
          icon: null,
        })
        didCreateAccount = true
      }
      try {
        const result = await linkDevice(
          session,
          localIdentity,
          (e: LinkingEvent) => {
            setLinkingState({
              state: 'event',
              event: e,
            })
          },
        )
        setLinkingState({
          state: 'result',
          result: result,
        })

        console.log('Device linking successful')
        console.log('App capability:', result.appToBrowserCap)
        console.log('Browser capability:', result.browserToAppCap)
        console.log('Profile alias:', result.profileAlias)

        await storeDeviceDelegation({
          profileAlias: result.profileAlias.raw,
          browserToAppCap: result.browserToAppCap.raw,
          appToBrowserCap: result.appToBrowserCap.raw,
        })
        return result
      } catch (e) {
        if (didCreateAccount) {
          logout()
        }
        throw e
      }
    },
    onError: (error) => {
      setLinkingState({
        state: 'error',
        error: (error as Error).message,
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries([queryKeys.ACCOUNT])
    },
  })
}

type Completion = {
  browserAccountId: string
  appAccountId: string
}

export function HMDeviceLink() {
  const [error, setError] = useState<string | null>(null)
  const [completion, setCompletion] = useState<Completion | null>(null)
  const [session, setSession] = useState<null | DeviceLinkSession>()

  useEffect(() => {
    const fragment = window.location.hash.substring(1)
    try {
      if (!fragment) {
        throw new Error('No fragment passed to /hm/device-link#FRAGMENT')
      }
      const decodedData = cborDecode(base58btc.decode(fragment))
      console.log('decodedData', decodedData)
      const session = DeviceLinkSessionSchema.parse(decodedData)
      setSession(session)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const {data: desktopAccount} = useResource(
    session ? hmId(session.accountId) : undefined,
  )
  const localIdentity = useLocalKeyPair()
  const localId = localIdentity ? hmId(localIdentity.id) : null
  const {data: browserAccount} = useResource(localId)
  const {data: existingAccount} = useAccount(localIdentity?.id)
  const browserAccountDocument =
    browserAccount?.type === 'document' ? browserAccount.document : undefined
  const desktopAccountDocument =
    desktopAccount?.type === 'document' ? desktopAccount.document : undefined
  const isLinkedAlready =
    session && existingAccount && session.accountId === existingAccount.id.uid
  const [linkingState, setLinkingState] = useState<LinkingState>(null)
  const linkDevice = useLinkDevice(localIdentity, setLinkingState)

  if (error) {
    return (
      <DeviceLinkContainer>
        <div className="flex flex-col items-center gap-5 rounded-sm border border-red-500 bg-red-100 p-4">
          <h2>Error linking device</h2>
          <p>{error}</p>
        </div>
      </DeviceLinkContainer>
    )
  }

  if (completion || isLinkedAlready) {
    return (
      <DeviceLinkContainer>
        {existingAccount && (
          <HMIcon
            name={existingAccount.metadata?.name}
            icon={existingAccount.metadata?.icon}
            id={existingAccount.id}
            size={48}
          />
        )}
        <h2>
          {existingAccount?.metadata?.name ? (
            <>
              You are signed in as{' '}
              <Text weight="bold">{existingAccount?.metadata?.name}</Text>
            </>
          ) : (
            'You are signed in'
          )}
        </h2>
        <div className="flex justify-center">
          <GoHomeButton />
        </div>
      </DeviceLinkContainer>
    )
  }

  const linkAccountName =
    desktopAccountDocument?.metadata?.name || 'Unknown Account'
  let heading: React.ReactNode = (
    <>
      Sign in to <Text weight="bold">{linkAccountName}</Text>
    </>
  )
  let description = `You can access your desktop account from this browser`
  let actionLabel = 'Approve Sign In'
  let extraContent: React.ReactNode | null =
    desktopAccountDocument?.metadata && desktopAccount ? (
      <HMIcon
        size={48}
        name={desktopAccountDocument.metadata?.name}
        icon={desktopAccountDocument.metadata?.icon}
        id={desktopAccount.id}
      />
    ) : null
  if (localId) {
    const browserAccountName =
      browserAccountDocument?.metadata?.name || 'Unknown Browser Account'
    heading = (
      <>
        Merge <Text weight="bold">{browserAccountName}</Text> to{' '}
        <Text weight="bold">{linkAccountName}</Text>
      </>
    )
    description = `Your "${browserAccountName}" web identity will be merged into "${linkAccountName}", and this browser will gain full access to this desktop account.`
    actionLabel = 'Approve Account Merge'
    extraContent =
      browserAccount && desktopAccount ? (
        <div className="flex gap-4">
          <HMIcon
            name={browserAccountDocument?.metadata?.name}
            icon={browserAccountDocument?.metadata?.icon}
            id={browserAccount?.id}
            size={36}
          />
          <ArrowRight size={36} />
          <HMIcon
            name={desktopAccountDocument?.metadata?.name}
            icon={desktopAccountDocument?.metadata?.icon}
            id={desktopAccount?.id}
            size={36}
          />
        </div>
      ) : null
  }

  if (linkingState && linkingState.state === 'error') {
    description = `Linking Error: ${linkingState.error}`
  }

  if (linkingState && linkingState.state === 'event') {
    const event = linkingState.event
    switch (event.type) {
      case 'dialing':
        description = `Dialing ${event.addr}...`
        break
      case 'dial-ok':
        description = `Dialed ${event.addr} successfully`
    }
  }

  return (
    <DeviceLinkContainer>
      <h2>{heading}</h2>
      <p>{description}</p>
      {extraContent}
      {/* {existingAccount && (
        <Paragraph>{JSON.stringify(existingAccount)}</Paragraph>
      )} */}
      <Button
        onClick={() => {
          if (!session) {
            setError('No device link session found')
            return
          }
          linkDevice
            .mutateAsync(session)
            .then((result) => {
              setCompletion({
                browserAccountId: result.browserAccountId,
                appAccountId: result.appAccountId,
              })
            })
            .catch((e) => {
              setError(e.message)
            })
        }}
        disabled={linkDevice.isLoading}
        variant="default"
      >
        {actionLabel}
        <Check size="size-4" />
      </Button>
    </DeviceLinkContainer>
  )
}

function GoHomeButton() {
  const {originHomeId} = useUniversalAppContext()
  const routeLink = useRouteLink(
    originHomeId
      ? {
          key: 'document',
          id: originHomeId,
        }
      : null,
    {
      handler: 'onClick',
    },
  )
  if (!originHomeId) {
    return null
  }
  return (
    <Button {...routeLink} size="sm" variant="default">
      Go Home
      <ArrowRight className="size-4" />
    </Button>
  )
}
