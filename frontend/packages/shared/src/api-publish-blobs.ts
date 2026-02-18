import {HMRequestImplementation} from './api-types'
import {HMPublishBlobsRequest} from './hm-types'

export const PublishBlobs: HMRequestImplementation<HMPublishBlobsRequest> = {
  async getData(grpcClient, input) {
    const result = await grpcClient.daemon.storeBlobs({
      blobs: input.blobs.map((b) => ({
        cid: b.cid || '',
        data: b.data,
      })),
    })
    return {cids: result.cids}
  },
}
