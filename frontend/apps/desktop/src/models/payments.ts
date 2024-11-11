import {useGRPCClient, useQueryInvalidator} from '@/app-context'
import {toPlainMessage} from '@bufbuild/protobuf'
import {useMutation, useQuery} from '@tanstack/react-query'
import {queryKeys} from './query-keys'

export function useCreateWallet() {
  const grpcClient = useGRPCClient()
  const invalidate = useQueryInvalidator()
  return useMutation({
    mutationFn: async (input: {accountUid: string}) => {
      await grpcClient.wallets.createWallet({
        account: input.accountUid,
      })
    },
    onSuccess: (result, vars, context) => {
      invalidate([queryKeys.ACCOUNT_WALLETS, vars.accountUid])
    },
  })
}

export function useListWallets(accountUid: string) {
  const grpcClient = useGRPCClient()
  return useQuery({
    queryKey: [queryKeys.ACCOUNT_WALLETS, accountUid],
    queryFn: async () => {
      const resp = await grpcClient.wallets.listWallets({
        account: accountUid,
      })
      const wallets = toPlainMessage(resp)
      return wallets
    },
  })
}

export function useDeleteWallet() {
  const grpcClient = useGRPCClient()
  const invalidate = useQueryInvalidator()
  return useMutation({
    mutationFn: async (input: {walletId: string; accountUid: string}) => {
      await grpcClient.wallets.removeWallet({
        id: input.walletId,
      })
    },
    onSuccess: (result, vars, context) => {
      invalidate([queryKeys.ACCOUNT_WALLETS, vars.accountUid])
    },
  })
}

export function useListInvoices(walletId: string) {
  const grpcClient = useGRPCClient()
  return useQuery({
    queryKey: [queryKeys.INVOICES, walletId],
    queryFn: async () => {
      const receivedQuery = await grpcClient.invoices.listReceivednvoices({
        id: walletId,
      })
      const received = toPlainMessage(receivedQuery).invoices
      const paidQuery = await grpcClient.invoices.listPaidInvoices({
        id: walletId,
      })
      const paid = toPlainMessage(paidQuery).invoices
      return {received, paid}
    },
  })
}

export function useExportWallet(walletId: string) {
  const grpcClient = useGRPCClient()
  return useMutation({
    mutationFn: async () => {
      const result = await grpcClient.wallets.exportWallet({
        id: walletId,
      })
      return result.credentials
    },
    onSuccess: (result, vars, context) => {},
  })
}

export function useCreateInvoice() {
  const grpcClient = useGRPCClient()
  return useMutation({
    mutationFn: async (input: {walletId: string; amount: bigint}) => {
      const result = await grpcClient.invoices.createInvoice({
        id: input.walletId,
        account: input.walletId,
        amount: input.amount,
      })
      return result.payreq
    },
    onSuccess: (result, vars, context) => {},
  })
}

export function useWallet(walletId: string) {
  const grpcClient = useGRPCClient()
  return useQuery({
    queryKey: [queryKeys.WALLETS, walletId],
    queryFn: async () => {
      const walletResp = await grpcClient.wallets.getWallet({
        id: walletId,
      })
      const wallet = toPlainMessage(walletResp)
      const balanceResp = await grpcClient.wallets.getWalletBalance({
        id: walletId,
      })
      return {...wallet, balance: balanceResp.balance}
    },
  })
}
