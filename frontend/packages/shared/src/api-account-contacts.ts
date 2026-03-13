import {toPlainMessage} from '@bufbuild/protobuf'
import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMAccountContactsRequest, HMContactSubscribe, HMContactRecord} from '@seed-hypermedia/client/hm-types'

export const AccountContacts: HMRequestImplementation<HMAccountContactsRequest> = {
  async getData(grpcClient: GRPCClient, input: string): Promise<HMContactRecord[]> {
    if (!input) return []
    const response = await grpcClient.documents.listContacts({
      filter: {
        case: 'account',
        value: input,
      },
    })
    return response.contacts.map((c) => {
      const plain = toPlainMessage(c)
      // Extract subscribe from metadata - use toJson() on the Struct to get plain JS object
      const metadata = c.metadata?.toJson() as Record<string, unknown> | undefined
      const subscribe = metadata?.subscribe as HMContactSubscribe | undefined
      return {
        id: plain.id,
        subject: plain.subject,
        name: plain.name,
        account: plain.account,
        signer: plain.signer,
        createTime: plain.createTime
          ? {
              seconds: Number(plain.createTime.seconds),
              nanos: plain.createTime.nanos,
            }
          : undefined,
        updateTime: plain.updateTime
          ? {
              seconds: Number(plain.updateTime.seconds),
              nanos: plain.updateTime.nanos,
            }
          : undefined,
        subscribe,
      }
    })
  },
}
