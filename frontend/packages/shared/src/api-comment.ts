import {toPlainMessage} from '@bufbuild/protobuf'
import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMCommentRequest, HMCommentSchema} from '@seed-hypermedia/client/hm-types'

export const Comment: HMRequestImplementation<HMCommentRequest> = {
  async getData(grpcClient: GRPCClient, input: string) {
    const rawComment = await grpcClient.comments.getComment({id: input})
    const plainComment = toPlainMessage(rawComment)
    return HMCommentSchema.parse(plainComment)
  },
}
