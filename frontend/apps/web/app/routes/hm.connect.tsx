import {getMetadata, getOriginRequestData} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {injectModels} from '@/models'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap, wrapJSON} from '@/wrapping'
import * as cbor from '@ipld/dag-cbor'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {hmId} from '@shm/shared'
import {
  DeviceLinkSession,
  HMMetadata,
  HMPeerConnectionRequest,
  HMPeerConnectionRequestSchema,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {queryKeys} from '@shm/shared/models/query-keys'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {SmallSiteHeader} from '@shm/ui/site-header'
import {ArrowUpRight} from '@tamagui/lucide-icons'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useState} from 'react'
import {
  Button,
  ButtonText,
  Heading,
  Paragraph,
  styled,
  View,
  YStack,
} from 'tamagui'
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

type ConnectPagePayload = {
  enableWebSigning: boolean
  originHomeId: UnpackedHypermediaId | undefined
  originHomeMetadata: HMMetadata | undefined
  origin: string
} & ReturnType<typeof getOriginRequestData>

export const meta: MetaFunction = ({data}) => {
  const {originHomeMetadata} = unwrap<ConnectPagePayload>(data)
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
    title: 'Connect to Seed Hypermedia Peer',
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
  } satisfies ConnectPagePayload)
}

export default function ConnectPage() {
  const {enableWebSigning, originHomeId, siteHost, origin, originHomeMetadata} =
    unwrap<ConnectPagePayload>(useLoaderData())
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
            <HMConnectPage />
          </View>
        </YStack>
        <PageFooter enableWebSigning={enableWebSigning} />
      </YStack>
    </WebSiteProvider>
  )
}

const ConnectionPageContainer = styled(YStack, {
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

export function HMConnectPage() {
  const [error, setError] = useState<string | null>(null)
  const [connectionInfo, setConnectionInfo] = useState<null | {
    encoded: string
    decoded: HMPeerConnectionRequest
  }>()

  useEffect(() => {
    const fragment = window.location.hash.substring(1)
    try {
      if (!fragment) {
        throw new Error('No fragment passed to /hm/device-link#FRAGMENT')
      }
      const decodedData = HMPeerConnectionRequestSchema.parse(
        cborDecode(base58btc.decode(fragment)),
      )
      console.log('decodedData', decodedData)
      setConnectionInfo({
        encoded: fragment,
        decoded: decodedData,
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  if (error) {
    return (
      <ConnectionPageContainer>
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
      </ConnectionPageContainer>
    )
  }

  return (
    <ConnectionPageContainer>
      <Heading>Connect to Seed Hypermedia Peer</Heading>
      <Paragraph textWrap="wrap" maxWidth="100%">
        Somebody wants to connect with you. Click the button below to launch the
        Seed Desktop App and connect.
      </Paragraph>
      {connectionInfo && (
        <Button
          theme="green"
          style={{textDecorationLine: 'none'}}
          tag="a"
          iconAfter={ArrowUpRight}
          href={`hm://connect/${connectionInfo.encoded}`}
        >
          Launch Seed Desktop App
        </Button>
      )}
      <Paragraph>
        If you don't have the Seed Desktop App installed, you can{' '}
        <ButtonText tag="a" href="https://seed.hypermedia.app/hm/download">
          download it here
        </ButtonText>
        .
      </Paragraph>
    </ConnectionPageContainer>
  )
}
