import {NavRoute, useCID} from '@shm/shared'
import {useRouteLink} from '@shm/shared/routing'
import {base58btc} from 'multiformats/bases/base58'
import {useMemo} from 'react'
import {Button} from './button'
import {DataViewer} from './data-viewer'
import {InspectorShell} from './inspector-shell'
import {Spinner} from './spinner'

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

  return (
    <div className="flex h-full max-h-full flex-col overflow-hidden bg-zinc-100">
      <div className="flex-1 overflow-y-auto">
        <InspectorShell title={`ipfs://${ipfsPath}`} toolbar={toolbar}>
          <div className="flex flex-col gap-4">
            {ipfsData.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner />
              </div>
            ) : preparedData === null || preparedData === undefined ? (
              <div className="text-muted-foreground text-sm">No IPFS data found.</div>
            ) : (
              <DataViewer data={preparedData} getRouteForUrl={getRouteForUrl} />
            )}
          </div>
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
