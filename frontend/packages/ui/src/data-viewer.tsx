import type {NavRoute} from '@shm/shared/routes'
import {useRouteLink} from '@shm/shared/routing'
import {memo, useState} from 'react'

type DataViewerProps = {
  data: unknown
  level?: number
  onNavigate?: (url: string) => void
  getRouteForUrl?: (url: string) => NavRoute | string | null
}

/** Renders nested JSON-like document data using the shared explorer tree view. */
export const DataViewer = memo(function DataViewer({data, level = 0, onNavigate, getRouteForUrl}: DataViewerProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const isTopLevel = level === 0

  if (data === null) return <span className="text-gray-500">null</span>
  if (data === undefined) return <span className="text-gray-500">undefined</span>

  if (data instanceof Uint8Array) {
    return <span className="text-blue-600">Binary Data ({data.length} bytes)</span>
  }

  if (typeof data === 'number') {
    return <span className="text-red-600">{data}</span>
  }

  if (typeof data === 'boolean') {
    return <span className="text-purple-600">{String(data)}</span>
  }

  if (typeof data === 'string') {
    if (data.includes('\n')) {
      return <div className="overflow-auto rounded bg-white p-2 font-mono whitespace-pre-wrap text-black">{data}</div>
    }

    if (data.startsWith('http://') || data.startsWith('https://')) {
      return (
        <a
          href={data}
          target="_blank"
          rel="noopener noreferrer"
          className="cursor-pointer font-mono text-blue-600 underline hover:underline"
        >
          {data}
        </a>
      )
    }

    if ((data.startsWith('hm://') || data.startsWith('ipfs://')) && (onNavigate || getRouteForUrl)) {
      return <DataViewerLink url={data} onNavigate={onNavigate} getRouteForUrl={getRouteForUrl} />
    }

    return <span className="font-mono text-black">{data}</span>
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-gray-500">[]</span>

    return (
      <div className={`overflow-auto rounded bg-white ${isTopLevel ? 'rounded-xl px-4 py-2' : ''}`}>
        <div className="flex overflow-auto">
          {!isTopLevel && (
            <div
              className="flex w-4 cursor-pointer items-center justify-center overflow-auto hover:bg-black"
              onClick={() => setIsExpanded((expanded) => !expanded)}
            />
          )}
          <div className="flex-1 overflow-auto">
            {isExpanded ? (
              <div className={isTopLevel ? 'overflow-auto' : 'overflow-auto border-l border-gray-200 pl-2'}>
                {data.map((item, index) => (
                  <div key={index} className="my-2 overflow-auto">
                    <DataViewer data={item} level={level + 1} onNavigate={onNavigate} getRouteForUrl={getRouteForUrl} />
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-gray-500">[{data.length} items]</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (typeof data === 'object') {
    const objectData = data as Record<string, unknown>
    const keys = Object.keys(objectData)

    if (keys.length === 0) {
      return <span className="text-gray-500">Empty Object</span>
    }

    return (
      <div className={`overflow-auto rounded bg-white ${isTopLevel ? 'rounded-xl px-4 py-2' : ''}`}>
        <div className="flex overflow-auto">
          {!isTopLevel && (
            <div
              className="flex w-4 cursor-pointer items-center justify-center overflow-auto hover:bg-black"
              onClick={() => setIsExpanded((expanded) => !expanded)}
            />
          )}
          <div className="flex-1 overflow-auto">
            {isExpanded ? (
              <div className={isTopLevel ? 'overflow-auto' : 'overflow-auto border-l border-gray-200 pl-2'}>
                {keys.map((key) => {
                  const value = objectData[key]
                  const isSimpleValue =
                    typeof value === 'number' ||
                    typeof value === 'boolean' ||
                    (typeof value === 'string' && !value.includes('\n') && value.length <= 50)

                  return (
                    <div
                      key={key}
                      className={
                        isSimpleValue ? 'my-1 flex items-center overflow-auto' : 'my-1 flex flex-col overflow-auto'
                      }
                    >
                      <span className="mr-2 font-bold text-gray-700">{key}:</span>
                      {isSimpleValue ? (
                        <DataViewer
                          data={value}
                          level={level + 1}
                          onNavigate={onNavigate}
                          getRouteForUrl={getRouteForUrl}
                        />
                      ) : (
                        <div className="ml-4 overflow-auto">
                          <DataViewer
                            data={value}
                            level={level + 1}
                            onNavigate={onNavigate}
                            getRouteForUrl={getRouteForUrl}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <span className="text-gray-500">{keys.join(', ')}</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return <span className="text-gray-500">{String(data)}</span>
})

function DataViewerLink({
  url,
  onNavigate,
  getRouteForUrl,
}: {
  url: string
  onNavigate?: (url: string) => void
  getRouteForUrl?: (url: string) => NavRoute | string | null
}) {
  const route = getRouteForUrl?.(url) || null
  const linkProps = useRouteLink(route)

  if (route) {
    return (
      <a {...linkProps} className="cursor-pointer font-mono text-blue-600 underline hover:underline">
        {url}
      </a>
    )
  }

  if (!onNavigate) {
    return <span className="font-mono text-black">{url}</span>
  }

  return (
    <span className="cursor-pointer font-mono text-blue-600 underline hover:underline" onClick={() => onNavigate(url)}>
      {url}
    </span>
  )
}

export default DataViewer
