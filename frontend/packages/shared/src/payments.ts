import {invalidateQueries, queryKeys} from '@shm/shared'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useEffect} from 'react'
import {z} from 'zod'
import {HMInvoice, UnpackedHypermediaId} from '.'

const LIGHTNING_API_URL = 'https://ln.testnet.seed.hyper.media'

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
        hash: serverInvoice.payment_hash,
        amount: input.amountSats,
        share: input.recipients,
      }
      return invoice
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
