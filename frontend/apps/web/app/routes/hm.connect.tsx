import {loadSiteHeaderData, SiteHeaderPayload} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {WebSiteHeader} from '@/web-site-header'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {
  HMPeerConnectionRequest,
  HMPeerConnectionRequestSchema,
} from '@shm/shared/hm-types'
import {Button} from '@shm/ui/button'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {cn} from '@shm/ui/utils'
import {ArrowUpRight} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useState} from 'react'

type ConnectPagePayload = SiteHeaderPayload

export const meta: MetaFunction = ({data}) => {
  const {homeMetadata} = unwrap<ConnectPagePayload>(data)
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
    title: 'Connect to Seed Hypermedia Peer',
  })
  return meta
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const headerData = await loadSiteHeaderData(parsedRequest)

  return wrapJSON(headerData satisfies ConnectPagePayload)
}

export default function ConnectPage() {
  const {originHomeId, siteHost, origin, homeMetadata, dehydratedState} =
    unwrap<ConnectPagePayload>(useLoaderData())
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
      <div className="flex min-h-screen flex-1 flex-col items-center">
        <WebSiteHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          siteHomeId={originHomeId}
          docId={null}
          origin={origin}
        />
        <div className="flex w-full max-w-lg flex-1 flex-col gap-3 px-0 pt-[var(--site-header-h)] sm:pt-4">
          <div className="px-4">
            <HMConnectPage />
          </div>
        </div>
        <PageFooter hideDeviceLinkToast={true} />
      </div>
    </WebSiteProvider>
  )
}

const ConnectionPageContainer = ({className, ...props}: any) => (
  <div
    className={cn(
      'dark:bg-dark flex flex-col items-center gap-5 rounded-sm bg-white p-4',
      className,
    )}
    {...props}
  />
)

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
        <div className="flex flex-col rounded-sm border border-red-500 bg-red-100 p-4">
          <p>{error}</p>
        </div>
      </ConnectionPageContainer>
    )
  }

  return (
    <ConnectionPageContainer>
      <h2>Connect to Seed Hypermedia Peer</h2>
      <p>
        Somebody wants to connect with you. Click the button below to launch the
        Seed Desktop App and connect.
      </p>
      {connectionInfo && (
        <Button variant="default" asChild>
          <a href={`hm://connect/${connectionInfo.encoded}`}>
            Launch Seed Desktop App <ArrowUpRight size="size-4" />
          </a>
        </Button>
      )}
      <p>
        If you don't have the Seed Desktop App installed, you can{' '}
        <a href="https://seed.hypermedia.app/hm/download">download it here</a>.
      </p>
    </ConnectionPageContainer>
  )
}
