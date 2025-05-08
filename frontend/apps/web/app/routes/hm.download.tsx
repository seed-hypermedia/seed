import {useFullRender} from '@/cache-policy'
import {loadSiteDocument, SiteDocumentPayload} from '@/loaders'
import downloadBg from '@/massets/download-bg.png'
import {defaultPageMeta} from '@/meta'
import {PageFooter} from '@/page-footer'
import {WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import {WebSiteHeader} from '@/web-site-header'
import {unwrap} from '@/wrapping'
import {useLoaderData} from '@remix-run/react'
import {hmId} from '@shm/shared'
import {Linux, Macos, Win32} from '@shm/ui/icons'
import {Button} from '@tamagui/button'
import {Download} from '@tamagui/lucide-icons'
import {SizableStack, XStack, YStack} from '@tamagui/stacks'
import {Heading, SizableText} from '@tamagui/text'
import {useEffect, useState} from 'react'
import {z} from 'zod'
import {Container} from '../ui/container'

async function isArm64(): Promise<boolean | null> {
  // this check only works on chrome, not safari. So we need to handle null and offer both dl buttons

  // @ts-expect-error
  const values = await navigator.userAgentData?.getHighEntropyValues([
    'architecture',
  ])
  if (!values) return null
  return values.architecture === 'arm'
}

function getOS(): undefined | 'mac' | 'windows' | 'linux' {
  const platform = navigator?.platform?.toLowerCase()
  if (!platform) return undefined
  if (platform.includes('mac')) return 'mac'
  if (platform.includes('win')) return 'windows'
  if (platform.includes('linux')) return 'linux'

  return undefined
}

async function getPlatform() {
  return {
    os: getOS(),
    isArm64: await isArm64(),
  }
}

const RELEASES_JSON_URL =
  'https://seedreleases.s3.eu-west-2.amazonaws.com/prod/latest.json'

const assetSchema = z.object({
  download_url: z.string(),
  zip_url: z.string().optional(),
})
const releaseSchema = z.object({
  name: z.string(),
  tag_name: z.string(),
  release_notes: z.string(),
  assets: z.object({
    macos: z
      .object({
        x64: assetSchema.optional(),
        arm64: assetSchema.optional(),
      })
      .optional(),
    win32: z
      .object({
        x64: assetSchema.optional(),
      })
      .optional(),
    linux: z
      .object({
        rpm: assetSchema.optional(),
        deb: assetSchema.optional(),
      })
      .optional(),
  }),
})

async function loadStableRelease() {
  const response = await fetch(RELEASES_JSON_URL)
  const data = await response.json()
  return releaseSchema.parse(data)
}

export const loader = async ({request}: {request: Request}) => {
  const parsedRequest = parseRequest(request)
  if (!useFullRender(parsedRequest)) return null
  const {hostname} = parsedRequest
  const serviceConfig = await getConfig(hostname)
  if (!serviceConfig) throw new Error(`No config defined for ${hostname}`)
  const {registeredAccountUid} = serviceConfig
  if (!registeredAccountUid)
    throw new Error(`No registered account uid defined for ${hostname}`)
  const result = await loadSiteDocument(
    parsedRequest,
    hmId('d', registeredAccountUid, {path: [], latest: true}),
    {
      stableRelease: await loadStableRelease(),
    },
  )
  return result
}

export const meta = defaultPageMeta('Download Seed Hypermedia')

export default function DownloadPage() {
  const data = unwrap<
    SiteDocumentPayload & {stableRelease: z.infer<typeof releaseSchema>}
  >(useLoaderData())
  const {
    stableRelease,
    originHomeId,
    siteHost,
    homeMetadata,
    id,
    document,
    origin,
    enableWebSigning,
  } = data
  //   const os = getOS();
  const [platform, setPlatform] = useState<
    Awaited<ReturnType<typeof getPlatform>> | undefined
  >(undefined)
  useEffect(() => {
    getPlatform().then(setPlatform)
  }, [])
  const suggestedButtons: React.ReactNode[] = []
  if (platform?.os === 'mac') {
    if (platform.isArm64 || platform.isArm64 == null) {
      suggestedButtons.push(
        <ReleaseEntry
          large
          label="Download Seed for Mac (Apple Silicon)"
          asset={stableRelease.assets?.macos?.arm64}
        />,
      )
    }
    if (!platform.isArm64) {
      suggestedButtons.push(
        <ReleaseEntry
          large
          label="Download Seed for Mac (Intel)"
          asset={stableRelease.assets?.macos?.x64}
        />,
      )
    }
  } else if (platform?.os === 'windows') {
    suggestedButtons.push(
      <ReleaseEntry
        large
        label="Download Seed for Windows x64"
        asset={stableRelease.assets?.win32?.x64}
      />,
    )
  } else if (platform?.os === 'linux') {
    suggestedButtons.push(
      <ReleaseEntry
        large
        label="Download Seed for Linux (rpm)"
        asset={stableRelease.assets?.linux?.rpm}
      />,
      <ReleaseEntry
        large
        label="Download Seed for Linux (deb)"
        asset={stableRelease.assets?.linux?.deb}
      />,
    )
  }
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
    >
      <YStack
        backgroundImage={`url(${downloadBg})`}
        backgroundSize="cover"
        backgroundPosition="top"
      >
        <WebSiteHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          docId={id}
          document={document}
          origin={origin}
          homeId={hmId('d', id.uid)}
        >
          <YStack
            minHeight="45vh"
            justifyContent="center"
            // backgroundColor="$brand12"
            alignItems="center"
            paddingVertical="$8"
          >
            <Container gap="$4" paddingHorizontal="$6">
              <Heading size="$10" textAlign="center" $gtMd={{size: '$13'}}>
                Download Seed Hypermedia Today!
              </Heading>
              <SizableText size="$6" textAlign="center">
                Start writing and collaborating with your peers.
              </SizableText>
              {suggestedButtons.length > 0 && suggestedButtons}
            </Container>
          </YStack>
          <Container>
            <YStack gap="$4" ai="center">
              <SizableText size="$8" fontWeight="bold">
                Download Seed Hypermedia {stableRelease.name}
              </SizableText>
            </YStack>
            <SizableStack
              flexDirection="column"
              $gtSm={{flexDirection: 'row'}}
              gap="$4"
              ai="center"
              jc="center"
              p="$4"
            >
              {stableRelease.assets?.macos && (
                <PlatformItem
                  label="MacOS"
                  icon={Macos}
                  assets={Object.entries(stableRelease.assets.macos).map(
                    ([key, value]) => ({
                      label: key,
                      url: value?.download_url,
                    }),
                  )}
                />
              )}
              {stableRelease.assets?.win32 && (
                <PlatformItem
                  label="Windows"
                  icon={Win32}
                  assets={Object.entries(stableRelease.assets.win32).map(
                    ([key, value]) => ({
                      label: key,
                      url: value?.download_url,
                    }),
                  )}
                />
              )}
              {stableRelease.assets?.linux && (
                <PlatformItem
                  label="Linux"
                  icon={Linux}
                  assets={Object.entries(stableRelease.assets.linux).map(
                    ([key, value]) => ({
                      label: key,
                      url: value?.download_url,
                    }),
                  )}
                />
              )}
            </SizableStack>
          </Container>
        </WebSiteHeader>
        <PageFooter enableWebSigning={enableWebSigning} />
      </YStack>
    </WebSiteProvider>
  )
}

function PlatformItem({
  label,
  icon: Icon,
  assets = [],
}: {
  label: string
  icon: React.ReactNode
  assets: Array<{
    label: string
    url: string
  }>
}) {
  return (
    <YStack
      $gtSm={{minWidth: 250, width: 'auto'}}
      width="100%"
      bg="$backgroundStrong"
      p="$4"
      gap="$3"
      borderRadius="$4"
      elevation="$2"
      ai="center"
    >
      <Icon color="hsl(171, 96%, 28%)" size={60} />
      <SizableText size="$5" fontWeight="bold">
        {label}
      </SizableText>
      <XStack gap="$2">
        {assets.map((asset) => (
          <Button
            className={`plausible-event-name=download plausible-event-os=${asset.url
              .split('.')
              .pop()}`}
            size="$2"
            icon={Download}
            tag="a"
            href={asset.url}
            style={{textDecoration: 'none'}}
          >
            {asset.label}
          </Button>
        ))}
      </XStack>
    </YStack>
  )
}

function ReleaseEntry({
  label,
  asset,
  large,
}: {
  label: string
  asset?: z.infer<typeof assetSchema>
  large?: boolean
}) {
  if (!asset) return null
  return (
    <Button
      tag="a"
      className={`plausible-event-name=download plausible-event-os=${asset.download_url
        .split('.')
        .pop()}`}
      href={asset.download_url}
      style={{textDecoration: 'none'}}
      download
      alignSelf="center"
      icon={Download}
      size={large ? '$6' : '$4'}
      borderRadius="$4"
      backgroundColor="$brand5"
      color="white"
      hoverStyle={{backgroundColor: '$brand4', color: 'white'}}
      focusStyle={{backgroundColor: '$brand3', color: 'white'}}
    >
      {label}
    </Button>
  )
}
