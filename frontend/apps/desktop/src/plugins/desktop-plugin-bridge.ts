import * as cbor from '@ipld/dag-cbor'
import type {UniversalClient} from '@shm/shared/routing'
import {dagJsonToIpld} from '@shm/ui/dag-json'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {createPluginBridge} from './plugin-bridge'
import {getDocumentPluginCapabilities} from './document-capabilities'
import type {PluginBridge} from './plugin-host'

/**
 * The standard desktop plugin bridge: blob capabilities via the universal
 * client, document capabilities late-bound through the document-capability
 * registry (so they work exactly when an editable document page is open —
 * whether the plugin was invoked by the assistant or from a document page).
 */
export function createDesktopPluginBridge(client: UniversalClient): PluginBridge {
  return createPluginBridge({
    getBlob: async (cid) => {
      const result = (await client.request('GetCID', {cid})) as {value?: unknown}
      return result.value
    },
    publishBlob: async (value) => {
      const data = cbor.encode(dagJsonToIpld(value))
      const digest = await sha256.digest(data)
      const cid = CID.createV1(0x71, digest).toString()
      await client.request('PublishBlobs', {blobs: [{cid, data}]})
      return {cid}
    },
    readDocument: async () => {
      const capabilities = getDocumentPluginCapabilities()
      if (!capabilities) throw new Error('No document is open')
      return capabilities.readDocument()
    },
    updateDocumentMetadata: async (patch) => {
      const capabilities = getDocumentPluginCapabilities()
      if (!capabilities?.updateDocumentMetadata) {
        throw new Error('No editable document is open (open the document and make sure you can edit it)')
      }
      return capabilities.updateDocumentMetadata(patch)
    },
  })
}
