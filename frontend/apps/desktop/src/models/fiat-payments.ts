import {payGrpcClient} from '@/grpc-client'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation} from '@tanstack/react-query'

export function useNewConnectedAccount() {
  return useMutation({
    mutationFn: async (input: {accountUid: string; url: string}) => {
      await payGrpcClient.connectedAccounts.newAccount({
        uid: input.accountUid,
        url: input.url,
      })
    },
    onSuccess: (result, vars, context) => {
      invalidateQueries([queryKeys.ACCOUNT_CONNECTED_ACCOUNT, vars.accountUid])
    },
  })
}

export function useCreateAccountLink() {
  return useMutation({
    mutationFn: async (input: {
      accountUid: string
      refreshUrl: string
      returnUrl: string
    }) => {
      return await payGrpcClient.connectedAccounts.createAccountLink({
        uid: input.accountUid,
        refreshUrl: input.refreshUrl,
        returnUrl: input.returnUrl,
      })
    },
  })
}

export function useCheckAccounts() {
  return useMutation({
    mutationFn: async (input: {accountUids: string[]}) => {
      return await payGrpcClient.connectedAccountsStatus.checkAccounts({
        uids: input.accountUids,
      })
    },
  })
}

export function useGetAccountBalance() {
  return useMutation({
    mutationFn: async (input: {accountUid: string}) => {
      return await payGrpcClient.connectedAccountsPayments.getAccountBalance({
        uid: input.accountUid,
      })
    },
  })
}

export function useGetConnectedAccount() {
  return useMutation({
    mutationFn: async (input: {accountUid: string}) => {
      return await payGrpcClient.connectedAccounts.getAccount({
        uid: input.accountUid,
      })
    },
    onSuccess: (result, vars, context) => {
      invalidateQueries([queryKeys.ACCOUNT_CONNECTED_ACCOUNT, vars.accountUid])
    },
  })
}

export function useCreateExpressPortalLink() {
  return useMutation({
    mutationFn: async (input: {accountUid: string}) => {
      return await payGrpcClient.connectedAccounts.getDashboardCredentials({
        uid: input.accountUid,
      })
    },
  })
}
