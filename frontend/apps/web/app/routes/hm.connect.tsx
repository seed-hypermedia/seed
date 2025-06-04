import {getMetadata, getOriginRequestData} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap, wrapJSON} from '@/wrapping'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {hmId} from '@shm/shared'
import {
  HMMetadata,
  HMPeerConnectionRequest,
  HMPeerConnectionRequestSchema,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {SmallSiteHeader} from '@shm/ui/site-header'
import {ArrowUpRight} from '@tamagui/lucide-icons'
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
        throw new Error('No fragment passed to /hm/connect#FRAGMENT')
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
