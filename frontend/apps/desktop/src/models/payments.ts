import {useGRPCClient, useQueryInvalidator} from '@/app-context'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {
  HMInvoice,
  Invoice,
  LIGHTNING_API_URL,
  UnpackedHypermediaId,
} from '@shm/shared'
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
      const all: PlainMessage<Invoice>[] = [...paid, ...received].sort(
        (a, b) => {
          return Number(new Date(b.settledAt)) - Number(new Date(b.settledAt))
        },
      )

      return {received, paid, all}
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

export function useCreateLocalInvoice() {
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

export function useInvoiceStatus() {
  return useQuery({
    queryKey: [],
    queryFn: () => {
      return null
    },
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

export function useAllowedPaymentRecipients(accountUids: string[]) {
  return useQuery({
    enabled: accountUids.length > 0,
    queryKey: [queryKeys.PAYMENT_RECIPIENTS, accountUids.join(',')],
    queryFn: async () => {
      let url = `${LIGHTNING_API_URL}/v2/check`
      accountUids.forEach((accountId, index) => {
        url += `${index === 0 ? '?' : '&'}user=${accountId}`
      })
      const res = await fetch(url)
      const output = await res.json()
      return (output.existing_users as string[]) || []
    },
  })
}

type CreateInvoiceRequest = {
  recipients: Record<string, number> // accountId: percentage
  docId: UnpackedHypermediaId
  amountSats: number
}

export function useCreateInvoice() {
  return useMutation({
    mutationFn: async (input: CreateInvoiceRequest) => {
      const params = new URLSearchParams()
      params.append('source', input.docId.uid)
      params.append('amount', `${input.amountSats * 1000}`)
      Object.entries(input.recipients).forEach(([accountId, amount]) => {
        params.append('user', `${accountId},${amount}`)
      })
      const res = await fetch(
        `${LIGHTNING_API_URL}/v2/invoice?${params.toString()}`,
        {},
      )
      const serverInvoice = await res.json()
      console.log(`== ~ serverInvoice`, serverInvoice)
      const invoice: HMInvoice = {
        payload: serverInvoice.pr,
        hash: serverInvoice.hash,
        amount: input.amountSats,
        share: input.recipients,
      }
      return invoice
    },
  })
}
