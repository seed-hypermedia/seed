import React, {memo, useState} from 'react'

interface DataViewerProps {
  data: any
  level?: number
  isInline?: boolean
  onNavigate?: (path: string) => void
}

export const DataViewer: React.FC<DataViewerProps> = memo(
  ({data, level = 0, onNavigate, isInline = false}) => {
    const [isExpanded, setIsExpanded] = useState(true)
    const isTopLevel = level === 0
    const toggleExpand = () => {
      setIsExpanded(!isExpanded)
    }

    if (data === null) return <span className="text-gray-500">null</span>
    if (data === undefined)
      return <span className="text-gray-500">undefined</span>

    if (data instanceof Uint8Array) {
      return (
        <span className="text-blue-600">Binary Data ({data.length} bytes)</span>
      )
    }

    if (typeof data === 'number') {
      return <span className="text-red-600">{data}</span>
    }

    if (typeof data === 'boolean') {
      return <span className="text-purple-600">{data.toString()}</span>
    }

    if (typeof data === 'string') {
      if (data.includes('\n')) {
        return (
          <div className="overflow-auto rounded bg-white p-2 font-mono whitespace-pre-wrap text-black">
            {data}
          </div>
        )
      }

      // Handle IPFS links
      if (data.startsWith('ipfs://') && onNavigate) {
        const ipfsPath = data.substring(7) // Remove "ipfs://" prefix
        return (
          <span
            className="cursor-pointer font-mono text-blue-600 underline hover:underline"
            onClick={() => onNavigate(`/ipfs/${ipfsPath}`)}
          >
            {data}
          </span>
        )
      }

      // Handle HTTP/HTTPS links
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

      // Handle HM links
      if (data.startsWith('hm://') && onNavigate) {
        const hmPath = data.substring(5) // Remove "hm://" prefix
        return (
          <span
            className="cursor-pointer font-mono text-blue-600 underline hover:underline"
            onClick={() => onNavigate(`/hm/${hmPath}`)}
          >
            {data}
          </span>
        )
      }

      return <span className="font-mono text-black">{data}</span>
    }

    if (Array.isArray(data)) {
      if (data.length === 0) return <span className="text-gray-500">[]</span>

      return (
        <div
          className={`overflow-auto rounded bg-white ${
            isTopLevel ? 'rounded-xl px-4 py-2' : ''
          }`}
        >
          <div className="flex overflow-auto">
            {!isTopLevel && (
              <div
                className="flex w-4 cursor-pointer items-center justify-center overflow-auto hover:bg-black"
                onClick={toggleExpand}
              />
            )}
            <div className="flex-1 overflow-auto">
              {isExpanded ? (
                <div
                  className={
                    isTopLevel
                      ? 'overflow-auto'
                      : 'overflow-auto border-l border-gray-200 pl-2'
                  }
                >
                  {data.map((item, index) => (
                    <div key={index} className="my-2 overflow-auto">
                      <DataViewer
                        data={item}
                        level={level + 1}
                        onNavigate={onNavigate}
                      />
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
      const keys = Object.keys(data)
      if (keys.length === 0)
        return <span className="text-gray-500">Empty Object</span>

      return (
        <div
          className={`overflow-auto rounded bg-white ${
            isTopLevel ? 'rounded-xl px-4 py-2' : ''
          }`}
        >
          <div className="flex overflow-auto">
            {!isTopLevel && (
              <div
                className="flex w-4 cursor-pointer items-center justify-center overflow-auto hover:bg-black"
                onClick={toggleExpand}
              />
            )}
            <div className="flex-1 overflow-auto">
              {isExpanded ? (
                <div
                  className={
                    isTopLevel
                      ? 'overflow-auto'
                      : 'overflow-auto border-l border-gray-200 pl-2'
                  }
                >
                  {keys.map((key) => {
                    const value = data[key]
                    const isSimpleValue =
                      typeof value === 'number' ||
                      typeof value === 'boolean' ||
                      (typeof value === 'string' &&
                        !value.includes('\n') &&
                        value.length <= 50)

                    return (
                      <div
                        key={key}
                        className={
                          isSimpleValue
                            ? 'my-1 flex items-center overflow-auto'
                            : 'my-1 flex flex-col overflow-auto'
                        }
                      >
                        <span className="mr-2 font-bold text-gray-700">
                          {key}:
                        </span>
                        {isSimpleValue ? (
                          <DataViewer
                            data={value}
                            level={level + 1}
                            isInline={true}
                            onNavigate={onNavigate}
                          />
                        ) : (
                          <div className="ml-4 overflow-auto">
                            <DataViewer
                              data={value}
                              level={level + 1}
                              onNavigate={onNavigate}
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
  },
)

export default DataViewer
