import type {PluginPermission} from '@shm/ui/plugin-manifest'
import type {PluginBridge} from './plugin-host'

/**
 * The permission-checked capability surface plugins reach through
 * `seed.call(method, params)`. The host enforces the manifest's declared
 * permissions before any of these run (plugin-host.ts); implementations here
 * still treat inputs as untrusted.
 *
 * Document capabilities are injected by whoever owns the host (they need the
 * current route/document machine); blob capabilities are injected with the
 * universal client. This keeps the bridge pure and unit-testable.
 */

export type PluginBridgeCapabilities = {
  /** `document:read` — the current document as structured data. */
  readDocument?: () => Promise<{id: string; metadata: Record<string, unknown>; content?: unknown}>
  /** `document:write` — stage a metadata patch into the current draft. */
  updateDocumentMetadata?: (patch: Record<string, unknown>) => Promise<void>
  /** `blob:read` — fetch a DAG-CBOR blob by CID (DAG-JSON face). */
  getBlob?: (cid: string) => Promise<unknown>
  /** `blob:write` — publish a DAG-CBOR value; returns its ipfs:// URL. */
  publishBlob?: (value: unknown) => Promise<{cid: string}>
}

const METHOD_PERMISSIONS: Record<string, PluginPermission> = {
  'document.read': 'document:read',
  'document.updateMetadata': 'document:write',
  'blob.get': 'blob:read',
  'blob.publish': 'blob:write',
}

/** Byte cap on any single bridge payload (either direction). */
const MAX_BRIDGE_PAYLOAD_BYTES = 1_000_000

function payloadSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return Infinity // circular or otherwise non-serializable: reject
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function createPluginBridge(capabilities: PluginBridgeCapabilities): PluginBridge {
  return {
    requiredPermission(method) {
      return METHOD_PERMISSIONS[method] ?? 'unknown-method'
    },
    async call(method, params) {
      if (payloadSize(params) > MAX_BRIDGE_PAYLOAD_BYTES) {
        throw new Error('Bridge call payload too large')
      }
      let result: unknown
      switch (method) {
        case 'document.read': {
          if (!capabilities.readDocument) throw new Error('No document is open')
          result = await capabilities.readDocument()
          break
        }
        case 'document.updateMetadata': {
          if (!capabilities.updateDocumentMetadata) throw new Error('No editable document is open')
          const patch = isPlainObject(params) && isPlainObject(params.patch) ? params.patch : null
          if (!patch) throw new Error('document.updateMetadata requires {patch: {…}}')
          await capabilities.updateDocumentMetadata(patch)
          result = {ok: true}
          break
        }
        case 'blob.get': {
          if (!capabilities.getBlob) throw new Error('Blob access unavailable')
          const cid = isPlainObject(params) && typeof params.cid === 'string' ? params.cid : null
          if (!cid) throw new Error('blob.get requires {cid: "…"}')
          result = await capabilities.getBlob(cid.replace(/^ipfs:\/\//, ''))
          break
        }
        case 'blob.publish': {
          if (!capabilities.publishBlob) throw new Error('Blob publishing unavailable')
          const value = isPlainObject(params) ? params.value : undefined
          if (value === undefined) throw new Error('blob.publish requires {value: …}')
          result = await capabilities.publishBlob(value)
          break
        }
        default:
          throw new Error(`Unknown method: ${method}`)
      }
      if (payloadSize(result) > MAX_BRIDGE_PAYLOAD_BYTES) {
        throw new Error('Bridge result too large')
      }
      return result
    },
  }
}
