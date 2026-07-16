import {NavRoute, useCID} from '@shm/shared'
import {useRouteLink} from '@shm/shared/routing'
import {base58btc} from 'multiformats/bases/base58'
import {type ReactNode, useEffect, useMemo, useState} from 'react'
import {Button} from './button'
import {DataViewer} from './data-viewer'
import {useImageUrl} from './get-file-url'
import {InspectorShell} from './inspector-shell'
import {Spinner} from './spinner'

/**
 * Probes whether an image URL loads. Returns `null` while testing, `true`/`false`
 * once known. Used to decide between the image view and the DAG-JSON tree —
 * raw uploaded files (images) are not DAG-CBOR, so this is more reliable than a
 * content-type header the daemon/gateway may not set.
 */
function useIsLoadableImage(imageUrl: string): boolean | null {
  const [isImage, setIsImage] = useState<boolean | null>(imageUrl ? null : false)
  useEffect(() => {
    if (!imageUrl || typeof window === 'undefined') {
      setIsImage(false)
      return
    }
    setIsImage(null)
    let cancelled = false
    const img = new window.Image()
    img.onload = () => {
      if (!cancelled) setIsImage(true)
    }
    img.onerror = () => {
      if (!cancelled) setIsImage(false)
    }
    img.src = imageUrl
    return () => {
      cancelled = true
    }
  }, [imageUrl])
  return isImage
}

/** Renders raw IPFS data inside the shared inspector layout. */
export function InspectIpfsPage({
  ipfsPath,
  exitRoute,
  getRouteForUrl,
}: {
  ipfsPath: string
  exitRoute?: NavRoute | null
  getRouteForUrl?: (url: string) => NavRoute | string | null
}) {
  const [cid, ...pathSegments] = ipfsPath.split('/').filter(Boolean)
  const ipfsData = useCID(cid)
  const exitLinkProps = useRouteLink(exitRoute || null)

  // Only a bare CID (no sub-path) can be a raw image file; a path implies
  // structured DAG data.
  const getImageUrl = useImageUrl()
  const imageUrl = pathSegments.length === 0 && cid ? getImageUrl(`ipfs://${cid}`) : ''
  const isImage = useIsLoadableImage(imageUrl)

  const preparedData = useMemo(() => {
    if (!ipfsData.data?.value) return null
    const cleaned = cleanInspectIpfsData(ipfsData.data.value)
    return readInspectIpfsPath(cleaned, pathSegments)
  }, [ipfsData.data?.value, pathSegments])

  const toolbar = exitRoute ? (
    <div className="flex justify-end">
      <Button asChild size="sm" variant="outline">
        <a {...exitLinkProps}>Open Resource</a>
      </Button>
    </div>
  ) : undefined

  let body: ReactNode
  if (isImage === null) {
    // Still probing whether this CID is a loadable image.
    body = (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  } else if (isImage) {
    body = (
      <div className="flex justify-center">
        <img
          src={imageUrl}
          alt={`ipfs://${cid}`}
          className="max-h-[80vh] max-w-full rounded-md object-contain shadow-sm"
        />
      </div>
    )
  } else if (ipfsData.isLoading) {
    body = (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  } else if (preparedData === null || preparedData === undefined) {
    body = <div className="text-muted-foreground text-sm">No IPFS data found.</div>
  } else {
    body = <DataViewer data={preparedData} getRouteForUrl={getRouteForUrl} />
  }

  return (
    <div className="flex h-full max-h-full flex-col overflow-hidden bg-zinc-100">
      <div className="flex-1 overflow-y-auto">
        <InspectorShell title={`ipfs://${ipfsPath}`} toolbar={toolbar}>
          <div className="flex flex-col gap-4">{body}</div>
        </InspectorShell>
      </div>
    </div>
  )
}

function cleanInspectIpfsData(data: unknown, parentKey?: string): unknown {
  if (!data) return null

  if (typeof data === 'object' && data && '/' in data) {
    const linkData = data as {'/': unknown}
    if (typeof linkData['/'] === 'object' && linkData['/'] && 'bytes' in (linkData['/'] as Record<string, unknown>)) {
      const bytesValue = (linkData['/'] as Record<string, unknown>).bytes
      if (typeof bytesValue !== 'string') return null
      const binaryString = atob(bytesValue)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i += 1) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return parentKey === 'signer' ? `hm://${base58btc.encode(bytes)}` : bytes
    }

    if (typeof linkData['/'] === 'string') {
      return `ipfs://${linkData['/']}`
    }
  }

  if (data instanceof Uint8Array) {
    return parentKey === 'signer' ? `hm://${base58btc.encode(data)}` : data
  }

  if (Array.isArray(data)) {
    return data.map((item) => cleanInspectIpfsData(item))
  }

  if (typeof data === 'object' && data !== null) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => {
        return [key, cleanInspectIpfsData(value, key)]
      }),
    )
  }

  return data
}

function readInspectIpfsPath(data: unknown, pathSegments: string[]): unknown {
  if (!pathSegments.length) return data

  return pathSegments.reduce<unknown>((currentValue, segment) => {
    if (Array.isArray(currentValue)) {
      const index = Number(segment)
      return Number.isInteger(index) ? currentValue[index] : undefined
    }
    if (typeof currentValue === 'object' && currentValue !== null) {
      return (currentValue as Record<string, unknown>)[segment]
    }
    return undefined
  }, data)
}
