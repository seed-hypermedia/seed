import {HMRequestImplementation} from './api-types'
import {HMPublishBlobsRequest} from '@seed-hypermedia/client/hm-types'

function normalizeBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const normalized = new Uint8Array(data.byteLength)
  normalized.set(data)
  return normalized
}

export const PublishBlobs: HMRequestImplementation<HMPublishBlobsRequest> = {
  async getData(grpcClient, input) {
    const result = await grpcClient.daemon.storeBlobs({
      blobs: input.blobs.map((b) => ({
        cid: b.cid || '',
        data: normalizeBytes(b.data),
      })),
    })
    return {cids: result.cids}
  },
}
