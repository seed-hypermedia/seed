import {useLocalKeyPair} from '@/auth'
import {DeviceLinkCompletion, useLinkDevice} from '@/device-linking'
import {getMetadata, getOriginRequestData} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {injectModels} from '@/models'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {unwrap, wrapJSON} from '@/wrapping'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {DeviceLinkSessionSchema, hmId} from '@shm/shared'
import {
  DeviceLinkSession,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useAccount, useEntity} from '@shm/shared/models/entity'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {SmallSiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useState} from 'react'
import {Button, Heading, Paragraph, View, YStack} from 'tamagui'

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

export function HMDeviceLink() {
  const [error, setError] = useState<string | null>(null)
  const [completion, setCompletion] = useState<DeviceLinkCompletion | null>(
    null,
  )
  const [deviceLinkSession, setDeviceLinkSession] =
    useState<null | DeviceLinkSession>()
  useEffect(() => {
    const fragment = window.location.hash.substring(1)
    try {
      if (!fragment) {
        throw new Error('No fragment passed to /hm/device-link#FRAGMENT')
      }
      const decodedData = cborDecode(base58btc.decode(fragment))
      console.log('decodedData', decodedData)
      const session = DeviceLinkSessionSchema.parse(decodedData)
      setDeviceLinkSession(session)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const {data: desktopAccount} = useEntity(
    deviceLinkSession ? hmId('d', deviceLinkSession.accountId) : undefined,
  )
  const localIdentity = useLocalKeyPair()
  const localId = localIdentity ? hmId('d', localIdentity.id) : null
  const {data: browserAccount} = useEntity(localId)
  const {data: existingAccount} = useAccount(localIdentity?.id)
  const isLinkedAlready =
    deviceLinkSession &&
    existingAccount &&
    deviceLinkSession.accountId === existingAccount.id.uid
  const linkDevice = useLinkDevice(localIdentity)

  if (error) {
    return (
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
    )
  }
  if (!deviceLinkSession) {
    return <Spinner />
  }

  if (completion || isLinkedAlready) {
    return (
      <YStack>
        <Heading>Signed in as {existingAccount?.metadata?.name}</Heading>
      </YStack>
    )
  }

  const linkAccountName =
    desktopAccount?.document?.metadata?.name || 'Unknown Account'
  let heading = `Sign in to ${linkAccountName}`
  let description = `You can access your desktop account from this browser`
  let actionLabel = 'Sign in'
  if (localId) {
    const browserAccountName =
      browserAccount?.document?.metadata?.name || 'Unknown Browser Account'
    heading = `Merge ${browserAccountName} to ${linkAccountName}`
    description = `Your "${browserAccountName}" web identity will become "${linkAccountName}", and this browser will gain full access to this desktop account.`
    actionLabel = 'Merge Account'
  }
  return (
    <YStack>
      <Heading>{heading}</Heading>
      <Paragraph>{description}</Paragraph>
      {/* {existingAccount && (
        <Paragraph>{JSON.stringify(existingAccount)}</Paragraph>
      )} */}
      <Button
        onPress={() => {
          if (!deviceLinkSession) {
            setError('No device link session found')
            return
          }
          linkDevice
            .mutateAsync(deviceLinkSession)
            .then((completion) => {
              setCompletion(completion)
            })
            .catch((e) => {
              setError(e.message)
            })
        }}
      >
        {actionLabel}
      </Button>
    </YStack>
  )
}
