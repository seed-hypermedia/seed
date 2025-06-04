import {useLocalKeyPair} from '@/auth'
import {getMetadata, getOriginRequestData} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {injectModels} from '@/models'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap, wrapJSON} from '@/wrapping'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {postCBOR} from '../api'
import type {DelegateDevicePayload} from './hm.api.delegate-device'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {createAccount, LocalWebIdentity, logout} from '../auth'
import {linkDevice, LinkingResult, LinkingEvent} from '../device-linking'
import * as cbor from '@ipld/dag-cbor'
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
import {useAccount, useEntity} from '@shm/shared/models/entity'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {SmallSiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {ArrowRight, Check} from '@tamagui/lucide-icons'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useState} from 'react'
import {
  Button,
  Heading,
  Paragraph,
  styled,
  Text,
  View,
  XStack,
  YStack,
} from 'tamagui'

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
    ? await getMetadata(hmId('d', config.registeredAccountUid))
    : undefined
  return wrapJSON({
    originHomeId: config?.registeredAccountUid
      ? hmId('d', config.registeredAccountUid)
      : undefined,
    ...getOriginRequestData(parsedRequest),
    originHomeMetadata: originHome?.metadata ?? undefined,
  } satisfies DeviceLinkPagePayload)
}

export default function DeviceLinkPage() {
  const {enableWebSigning, originHomeId, siteHost, origin, originHomeMetadata} =
    unwrap<DeviceLinkPagePayload>(useLoaderData())
  if (!originHomeId) {
    return <Heading>Invalid origin home id</Heading>
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
    >
      <YStack ai="center" flex={1} minHeight="100vh">
        {originHomeMetadata && (
          <SmallSiteHeader
            originHomeMetadata={originHomeMetadata}
            originHomeId={originHomeId}
            siteHost={siteHost}
          />
        )}
        <YStack
          flex={1}
          gap="$3"
          width="100%"
          maxWidth={600}
          paddingTop="$4"
          paddingHorizontal={0}
        >
          <View paddingHorizontal="$4">
            <HMDeviceLink />
          </View>
        </YStack>
        <PageFooter enableWebSigning={enableWebSigning} />
      </YStack>
    </WebSiteProvider>
  )
}

const DeviceLinkContainer = styled(YStack, {
  gap: '$5',
  ai: 'center',
  borderRadius: '$3',
  padding: '$4',
  backgroundColor: '$backgroundStrong',
})

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

  const {data: desktopAccount} = useEntity(
    session ? hmId('d', session.accountId) : undefined,
  )
  const localIdentity = useLocalKeyPair()
  const localId = localIdentity ? hmId('d', localIdentity.id) : null
  const {data: browserAccount} = useEntity(localId)
  const {data: existingAccount} = useAccount(localIdentity?.id)
  const isLinkedAlready =
    session && existingAccount && session.accountId === existingAccount.id.uid
  const [linkingState, setLinkingState] = useState<LinkingState>(null)
  const linkDevice = useLinkDevice(localIdentity, setLinkingState)

  if (error) {
    return (
      <DeviceLinkContainer>
        <YStack
          theme="red"
          borderRadius="$3"
          padding="$4"
          borderColor="$red10"
          backgroundColor="$red3"
        >
          <Heading>Error linking device</Heading>
          <Paragraph>{error}</Paragraph>
        </YStack>
      </DeviceLinkContainer>
    )
  }

  if (completion || isLinkedAlready) {
    return (
      <DeviceLinkContainer>
        {existingAccount && (
          <HMIcon
            metadata={existingAccount.metadata}
            id={existingAccount.id}
            size={48}
          />
        )}
        <Heading>
          {existingAccount?.metadata?.name ? (
            <>
              You are signed in as{' '}
              <Text fontWeight="bold">{existingAccount?.metadata?.name}</Text>
            </>
          ) : (
            'You are signed in'
          )}
        </Heading>
        <XStack jc="center">
          <GoHomeButton />
        </XStack>
      </DeviceLinkContainer>
    )
  }

  const linkAccountName =
    desktopAccount?.document?.metadata?.name || 'Unknown Account'
  let heading: React.ReactNode = (
    <>
      Sign in to <Text fontWeight="bold">{linkAccountName}</Text>
    </>
  )
  let description = `You can access your desktop account from this browser`
  let actionLabel = 'Approve Sign In'
  let extraContent: React.ReactNode | null = desktopAccount?.document
    ?.metadata ? (
    <HMIcon
      size={48}
      metadata={desktopAccount.document.metadata}
      id={desktopAccount.id}
    />
  ) : null
  if (localId) {
    const browserAccountName =
      browserAccount?.document?.metadata?.name || 'Unknown Browser Account'
    heading = (
      <>
        Merge <Text fontWeight="bold">{browserAccountName}</Text> to{' '}
        <Text fontWeight="bold">{linkAccountName}</Text>
      </>
    )
    description = `Your "${browserAccountName}" web identity will be merged into "${linkAccountName}", and this browser will gain full access to this desktop account.`
    actionLabel = 'Approve Account Merge'
    extraContent =
      browserAccount && desktopAccount ? (
        <XStack gap="$4">
          <HMIcon
            metadata={browserAccount.document?.metadata}
            id={browserAccount?.id}
            size={36}
          />
          <ArrowRight size={36} />
          <HMIcon
            metadata={desktopAccount.document?.metadata}
            id={desktopAccount?.id}
            size={36}
          />
        </XStack>
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
      <Heading>{heading}</Heading>
      <Paragraph textWrap="wrap" maxWidth="100%">
        {description}
      </Paragraph>
      {extraContent}
      {/* {existingAccount && (
        <Paragraph>{JSON.stringify(existingAccount)}</Paragraph>
      )} */}
      <Button
        onPress={() => {
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
        color="$color1"
        iconAfter={Check}
        backgroundColor="$brand5"
        hoverStyle={{
          backgroundColor: '$brand6',
        }}
        pressStyle={{
          backgroundColor: '$brand7',
        }}
      >
        {actionLabel}
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
  )
  if (!originHomeId) {
    return null
  }
  return (
    <Button
      {...routeLink}
      size="$2"
      color="$color1"
      iconAfter={ArrowRight}
      backgroundColor="$brand5"
      hoverStyle={{
        backgroundColor: '$brand6',
      }}
      pressStyle={{
        backgroundColor: '$brand7',
      }}
    >
      Go Home
    </Button>
  )
}
