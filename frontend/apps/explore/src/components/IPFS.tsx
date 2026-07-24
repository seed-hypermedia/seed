import {useCID} from '@shm/shared'
import {useOnyxSchemaRegistry, validate} from '@shm/ui/onyx/index'
import {inspectorBlobActions} from '@shm/ui/inspect-ipfs-page'
import {Pencil} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import React, {useMemo} from 'react'
import {useParams} from 'react-router-dom'
import {useHmNavigate} from '../utils/useHmNavigate'
import {useApiHost} from '../apiHostStore'
import {seedEditUrl} from '../utils/seedEditUrl'
import {CopyTextButton} from './CopyTextButton'
import {DataViewer} from './DataViewer'
import {DownloadButton} from './DownloadButton'
import {Title} from './Title'

const IPFS: React.FC = () => {
  const {cid} = useParams()
  const apiHost = useApiHost()
  const {data} = useCID(cid)
  const navigate = useHmNavigate()
  const revisedData = useMemo(() => {
    if (!data?.value) return null

    const cleaned = cleanIPLDData(data.value)
    if (cleaned.signer && cleaned.signer instanceof Uint8Array) {
      cleaned.signer = `hm://${base58btc.encode(cleaned.signer)}`
    }
    return cleaned
  }, [data])

  // Schema-awareness, shared with the in-app inspector (@shm/ui). Detect schema
  // blobs and advisory-validate instances against their attached schema.
  const rawValue = data?.value
  const {canEdit, valueIsSchema, hasAttachedSchema, attachedSchemaCid} = useMemo(
    () => inspectorBlobActions(cid, rawValue, true),
    [cid, rawValue],
  )
  const editUrl = canEdit ? seedEditUrl(import.meta.env.VITE_SEED_WEB_ORIGIN, cid) : null
  const schemaSeeds = useMemo(() => (attachedSchemaCid ? [attachedSchemaCid] : []), [attachedSchemaCid])
  const {byCid, isComplete: schemaComplete} = useOnyxSchemaRegistry(schemaSeeds)
  const rootSchema = attachedSchemaCid ? byCid[attachedSchemaCid] : undefined
  const warningCount = useMemo(() => (rootSchema ? validate(rootSchema, rawValue).length : 0), [rootSchema, rawValue])

  return (
    <div className="container mx-auto p-4">
      <Title
        buttons={
          <>
            <CopyTextButton text={`ipfs://${cid}`} />
            <DownloadButton url={`${apiHost}/ipfs/${cid}`} />
            {editUrl && (
              <a
                href={editUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-2 p-2 text-gray-500 transition-colors hover:text-gray-700"
                title="Edit in Seed"
              >
                <Pencil className="size-4" />
              </a>
            )}
          </>
        }
        title={`ipfs://${cid}`}
      />
      {(valueIsSchema || hasAttachedSchema) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {valueIsSchema && (
            <span className="rounded bg-violet-100 px-2 py-0.5 font-medium text-violet-700">Schema</span>
          )}
          {hasAttachedSchema && attachedSchemaCid && (
            <button
              className="rounded bg-zinc-200 px-2 py-0.5 font-medium text-zinc-600 hover:underline"
              onClick={() => navigate(`/ipfs/${attachedSchemaCid}`)}
              title={`ipfs://${attachedSchemaCid}`}
            >
              Schema: {attachedSchemaCid.slice(0, 12)}…
            </button>
          )}
          {rootSchema && warningCount === 0 && schemaComplete && (
            <span className="font-medium text-emerald-600">✓ Matches schema</span>
          )}
          {rootSchema && warningCount > 0 && (
            <span className="font-medium text-amber-600">
              ⚠ {warningCount} field{warningCount === 1 ? '' : 's'} don&apos;t match
            </span>
          )}
        </div>
      )}
      {revisedData && (
        <div className="mt-4">
          <DataViewer data={revisedData} onNavigate={navigate} />
        </div>
      )}
    </div>
  )
}

function cleanIPLDData(data: any): any {
  if (!data) return null
  if (typeof data === 'object' && data['/']) {
    if (typeof data['/'] === 'object' && data['/'].bytes) {
      const binaryString = atob(data['/'].bytes)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return bytes
    }
    return `ipfs://${data['/']}`
  }
  if (Array.isArray(data)) {
    return data.map((item) => cleanIPLDData(item))
  }
  if (typeof data === 'object') {
    const result: Record<string, any> = {}
    for (const key in data) {
      result[key] = cleanIPLDData(data[key])
    }
    return result
  }
  return data
}

export default IPFS
