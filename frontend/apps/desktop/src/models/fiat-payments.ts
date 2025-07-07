import {payGrpcClient} from '@/grpc-client'
import {useMutation} from '@tanstack/react-query'

export function useNewConnectedAccount() {
  return useMutation({
    mutationFn: async (input: {accountUid: string, url: string}) => {
      await payGrpcClient.connectedAccounts.newAccount({
        uid: input.accountUid,
        url: input.url,
      })
    },
  })
}