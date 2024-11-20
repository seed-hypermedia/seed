import {useGRPCClient} from '@/app-context'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {
  HMInvoice,
  HMWallet,
  invalidateQueries,
  Invoice,
  LIGHTNING_API_URL,
  queryKeys,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'
import {z} from 'zod'

export function useCreateWallet() {
  const grpcClient = useGRPCClient()
  return useMutation({
    mutationFn: async (input: {accountUid: string}) => {
      await grpcClient.wallets.createWallet({
        account: input.accountUid,
      })
    },
    onSuccess: (result, vars, context) => {
      invalidateQueries([queryKeys.ACCOUNT_WALLETS, vars.accountUid])
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
  return useMutation({
    mutationFn: async (input: {walletId: string; accountUid: string}) => {
      await grpcClient.wallets.removeWallet({
        id: input.walletId,
      })
    },
    onSuccess: (result, vars, context) => {
      invalidateQueries([queryKeys.ACCOUNT_WALLETS, vars.accountUid])
    },
  })
}

export function useDecodedInvoice(payreq: string) {
  const grpcClient = useGRPCClient()
  const [invoice, setInvoice] = useState<HMInvoice | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      if (!payreq) {
        setInvoice(null)
        return
      }
      grpcClient.invoices
        .decodeInvoice({payreq})
        .then((res) => {
          console.log('decoded invoice', res)
          setInvoice({
            amount: Number(res.amount),
            hash: res.paymentHash,
            description: res.description,
            payload: payreq,
            share: {},
          })
        })
        .catch((e) => {
          setInvoice(null)
        })
    }, 250)
  }, [payreq])
  function reset() {
    setInvoice(null)
  }
  return [invoice, reset] as const
}

export function useListInvoices(walletId: string) {
  const grpcClient = useGRPCClient()
  return useQuery({
    queryKey: [queryKeys.INVOICES, walletId],
    queryFn: async () => {
      const receivedQuery = await grpcClient.invoices.listReceivedInvoices({
        id: walletId,
      })
      const received = toPlainMessage(receivedQuery).invoices
      const paidQuery = await grpcClient.invoices.listPaidInvoices({
        id: walletId,
      })

      const paid = toPlainMessage(paidQuery).invoices
      const all: PlainMessage<Invoice>[] = [...paid, ...received]
        .sort((a, b) => {
          return Number(new Date(b.settledAt)) - Number(new Date(a.settledAt))
        })
        .filter((invoice) => invoice.status === 'settled')

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
    mutationFn: async ({
      walletId,
      amount,
      description,
    }: {
      walletId: string
      amount: bigint
      description: string
    }) => {
      const result = await grpcClient.invoices.createInvoice({
        id: walletId,
        account: walletId,
        amount: amount,
        memo: description,
      })
      const invoice: HMInvoice = {
        amount: Number(amount),
        hash: result.paymentHash,
        payload: result.payreq,
        share: {
          [walletId]: 1,
        },
      }
      return invoice
    },
    onSuccess: (result, vars, context) => {},
  })
}

export function usePayInvoice() {
  const grpcClient = useGRPCClient()
  return useMutation({
    mutationFn: async (input: {
      walletId: string
      accountUid: string
      // payreq: string
      invoice: HMInvoice
    }) => {
      await grpcClient.invoices.payInvoice({
        id: input.walletId,
        payreq: input.invoice.payload,
        account: input.accountUid,
        amount: BigInt(input.invoice.amount),
      })
    },
  })
}

const InvoiceStatusSchema = z.array(
  z.object({
    status: z.union([z.literal('open'), z.literal('settled')]),
  }),
)

export function useInvoiceStatus(invoice: HMInvoice | null) {
  const status = useQuery({
    queryKey: [queryKeys.INVOICE_STATUS, invoice?.hash],
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    queryFn: async () => {
      if (!invoice) return {isSettled: false}
      const url = `${LIGHTNING_API_URL}/v2/invoicemeta/${invoice.hash}`
      console.log('fetching', url)
      const res = await fetch(url, {})
      const serverInvoice = await res.json()
      console.log('server meta', serverInvoice)
      const invoiceMeta = InvoiceStatusSchema.parse(serverInvoice)
      const isSettled = invoiceMeta.every((meta) => meta.status === 'settled')
      return {isSettled}
    },
  })
  useEffect(() => {
    invalidateQueries([queryKeys.INVOICES])
  }, [status.data?.isSettled])
  return status
}

export function useWallet(walletId: string) {
  const grpcClient = useGRPCClient()
  return useQuery({
    queryKey: [queryKeys.WALLETS, walletId],
    keepPreviousData: false,
    queryFn: async () => {
      const walletResp = await grpcClient.wallets.getWallet({
        id: walletId,
      })
      const wallet = toPlainMessage(walletResp)
      const balanceResp = await grpcClient.wallets.getWalletBalance({
        id: walletId,
      })
      const fullWallet: HMWallet = {
        ...wallet,
        balance: Number(balanceResp.balance),
      }
      return fullWallet
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
  description: string
}

export function useCreateInvoice() {
  return useMutation({
    mutationFn: async (input: CreateInvoiceRequest) => {
      const params = new URLSearchParams()
      params.append('source', input.docId.uid)
      params.append('memo', input.description)
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
        hash: serverInvoice.payment_hash,
        amount: input.amountSats,
        share: input.recipients,
      }
      return invoice
    },
  })
}
