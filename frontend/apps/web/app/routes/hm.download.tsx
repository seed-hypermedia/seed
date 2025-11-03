import downloadBg from '@/assets/download-bg.png'
import {useFullRender} from '@/cache-policy'
import {loadSiteResource, SiteDocumentPayload} from '@/loaders'
import {defaultPageMeta} from '@/meta'
import {PageFooter} from '@/page-footer'
import {WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import {WebSiteHeader} from '@/web-site-header'
import {unwrap} from '@/wrapping'
import {useLoaderData, useSearchParams} from '@remix-run/react'
import {hmId} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {Download, Linux, Macos, Win32} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {useCallback, useEffect, useState} from 'react'
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
  download_url: z.string().optional(),
  zip_url: z.string().optional(),
  nupkg_url: z.string().optional(),
  release_url: z.string().optional(),
})

const releaseSchema = z.object({
  name: z.string(),
  tag_name: z.string(),
  release_notes: z.string(),
  assets: z.object({
    macos: z.object({
      x64: assetSchema.optional(),
      arm64: assetSchema.optional(),
    }),
    win32: z.object({
      x64: assetSchema.optional(),
    }),
    linux: z.object({
      rpm: assetSchema.optional(),
      deb: assetSchema.optional(),
      app_image: assetSchema.optional(),
      flatpak: assetSchema.optional(),
    }),
  }),
})

async function loadUpstreamRelease() {
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
  const stableRelease = await loadUpstreamRelease()
  return await loadSiteResource(
    parsedRequest,
    hmId(registeredAccountUid, {path: [], latest: true}),
    {
      stableRelease,
    },
  )
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
    supportDocuments,
    supportQueries,
    origin,
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
      <ReleaseEntry
        large
        label="Download Seed for Linux (AppImage)"
        asset={stableRelease.assets?.linux?.app_image}
      />,
      <ReleaseEntry
        large
        label="Download Seed for Linux (Flatpak)"
        asset={stableRelease.assets?.linux?.flatpak}
      />,
    )
  }
  const [searchParams, setSearchParams] = useSearchParams()
  const handleToggleFeed = useCallback(() => {
    const currentFeed = searchParams.get('feed') === 'true'
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)
      if (currentFeed) {
        newParams.delete('feed')
      } else {
        newParams.set('feed', 'true')
      }
      return newParams
    })
  }, [searchParams, setSearchParams])
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
    >
      <div
        className="bg-cover bg-top"
        style={{backgroundImage: `url(${downloadBg})`}}
      >
        <WebSiteHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          docId={id}
          document={document}
          supportDocuments={supportDocuments}
          supportQueries={supportQueries}
          origin={origin}
          handleToggleFeed={handleToggleFeed}
        />
        <div className="flex min-h-[45vh] flex-col items-center justify-center py-8">
          <Container className="gap-4 px-6">
            <h1 className="text-center text-4xl font-bold md:text-5xl">
              Download Seed Hypermedia Today!
            </h1>
            <SizableText size="xl" className="text-center">
              Start writing and collaborating with your peers.
            </SizableText>
            <div className="flex flex-col gap-4">
              {suggestedButtons.length > 0 && suggestedButtons}
            </div>
          </Container>
        </div>
        <Container>
          <div className="flex flex-col items-center justify-center gap-4">
            <SizableText size="2xl" weight="bold">
              Download Seed Hypermedia {stableRelease.name}
            </SizableText>
          </div>
          <div className="flex flex-col items-center justify-center gap-4 p-4 sm:flex-row">
            {stableRelease.assets?.macos && (
              <PlatformItem
                label="MacOS"
                icon={Macos}
                assets={stableRelease.assets.macos}
              />
            )}
            {stableRelease.assets?.win32 && (
              <PlatformItem
                label="Windows"
                icon={Win32}
                assets={stableRelease.assets.win32}
              />
            )}
            {stableRelease.assets?.linux && (
              <PlatformItem
                label="Linux"
                icon={Linux}
                assets={stableRelease.assets.linux}
              />
            )}
          </div>
        </Container>
        <PageFooter hideDeviceLinkToast={true} />
      </div>
    </WebSiteProvider>
  )
}

function PlatformItem({
  label,
  icon: Icon,
  assets,
}: {
  label: string
  icon: any
  assets: Record<string, z.infer<typeof assetSchema> | {} | undefined>
}) {
  const assetArray = Object.entries(assets)
    .filter(([_, asset]) => asset && 'download_url' in asset)
    .map(([key, asset]) => ({
      label: key,
      url: (asset as z.infer<typeof assetSchema>).download_url,
    }))

  return (
    <div className="border-border flex w-full flex-col items-center gap-3 rounded-md border bg-white p-4 shadow-xl sm:w-auto sm:min-w-3xs dark:bg-black">
      <Icon size={60} className="size-[60px]" />
      <SizableText size="lg" weight="bold">
        {label}
      </SizableText>
      <div className="flex gap-2">
        {assetArray.map(
          (asset) =>
            asset.url && (
              <Button
                key={asset.label}
                variant="link"
                className={`plausible-event-name=download plausible-event-os=${asset.url
                  .split('.')
                  .pop()}`}
                size="sm"
                asChild
              >
                <a href={asset.url} style={{textDecoration: 'none'}}>
                  <Download className="size-3" />
                  {asset.label}
                </a>
              </Button>
            ),
        )}
      </div>
    </div>
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
  if (!asset.download_url) return null
  return (
    <Button
      asChild
      variant="default"
      className={`plausible-event-name=download p-8 plausible-event-os=${asset.download_url
        .split('.')
        .pop()} self-center rounded-md`}
      style={{textDecoration: 'none'}}
      size={large ? 'lg' : 'default'}
    >
      <a href={asset.download_url}>
        <Download className={large ? 'size-6' : 'size-4'} />{' '}
        <span className="text-xl">{label}</span>
      </a>
    </Button>
  )
}
