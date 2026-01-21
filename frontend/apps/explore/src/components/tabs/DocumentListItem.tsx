import {hmIdPathToEntityQueryPath, hmIdToURL} from '@shm/shared'
import {Copy, ExternalLink} from 'lucide-react'
import {copyToClipboardWithToast} from '../../utils/clipboard'

export function DocumentListItem({doc, apiHost}: {doc: any; apiHost: string}) {
  const url = hmIdToURL(doc.id)
  let webUrl = `${apiHost}/hm/${doc.id.type}/${
    doc.id.uid
  }${hmIdPathToEntityQueryPath(doc.id.path)}`
  if (doc.id.version) {
    webUrl += `?v=${doc.id.version}`
  }
  return (
    <a
      key={doc.id.id}
      href={`/hm/${doc.id.uid}/${doc.id.path?.join('/') || ''}`}
      className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-white p-3 hover:bg-gray-50"
    >
      <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
        {doc.metadata?.name || doc.id.path?.at(-1) || 'Untitled'}
      </span>
      <div className="flex flex-shrink-0 items-center space-x-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          className="group/button relative rounded-full p-1.5 hover:bg-gray-100"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            copyToClipboardWithToast(url)
          }}
        >
          <Copy className="h-4 w-4" />
          <span className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 transition-opacity group-hover/button:opacity-100">
            Copy URL
          </span>
        </button>
        <button
          className="group/button relative rounded-full p-1.5 hover:bg-gray-100"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            window.open(webUrl, '_blank')
          }}
        >
          <ExternalLink className="h-4 w-4" />
          <span className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 transition-opacity group-hover/button:opacity-100">
            Open in new tab
          </span>
        </button>
        <button
          className="group/button relative rounded-full p-1.5 hover:bg-gray-100"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            window.open(url, '_blank')
          }}
        >
          <ExternalLink className="h-4 w-4 text-green-500" />
          <span className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded bg-gray-900 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 transition-opacity group-hover/button:opacity-100">
            Open in Seed App
          </span>
        </button>
      </div>
    </a>
  )
}
