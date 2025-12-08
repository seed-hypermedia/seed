import {toPlainMessage} from '@bufbuild/protobuf'
import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMAccountContactsRequest, HMContactRecord} from './hm-types'

export const AccountContacts: HMRequestImplementation<HMAccountContactsRequest> =
  {
    async getData(
      grpcClient: GRPCClient,
      input: string,
    ): Promise<HMContactRecord[]> {
      if (!input) return []
      const response = await grpcClient.documents.listContacts({
        filter: {
          case: 'account',
          value: input,
        },
      })
      return response.contacts.map((c) => {
        const plain = toPlainMessage(c)
        return {
          id: plain.id,
          subject: plain.subject,
          name: plain.name,
          account: plain.account,
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
        }
      })
    },
  }
