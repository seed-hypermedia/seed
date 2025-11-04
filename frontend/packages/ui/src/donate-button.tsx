import {
  applyIsEvenAllocation,
  applyRecipientAmount,
  applyTotalAmount,
  DEFAULT_PAYMENT_AMOUNTS,
  getAllocations,
  getMetadataName,
  HMInvoice,
  HMMetadataPayload,
  PaymentAllocation,
  UnpackedHypermediaId,
  useAllowedPaymentRecipients,
  useCreateInvoice,
  useInvoiceStatus,
} from '@shm/shared'
import {Button} from './button'

import {AlertCircle, CircleDollarSign, Copy, PartyPopper} from 'lucide-react'
import {useState} from 'react'
import QRCode from 'react-qr-code'
import {CheckboxField} from './components/checkbox'
import {DialogDescription, DialogTitle} from './components/dialog'
import {Input} from './components/input'
import {Label} from './components/label'
import {copyTextToClipboard} from './copy-to-clipboard'
import {HMIcon} from './hm-icon'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {useAppDialog} from './universal-dialog'

declare global {
  interface Window {
    webln?: {
      enable(): Promise<void>
      sendPayment(invoice: string): Promise<any>
    }
  }
}

async function sendWeblnPayment(invoice: string) {
  if (typeof window.webln !== 'undefined') {
    await window.webln.enable()
    return await window.webln.sendPayment(invoice)
  }
}

export function DonateButton({
  docId,
  authors,
}: {
  docId: UnpackedHypermediaId
  authors: HMMetadataPayload[]
}) {
  const donateDialog = useAppDialog(DonateDialog)
  const allowedRecipients = useAllowedPaymentRecipients(
    authors.map((author) => author.id.uid) || [],
  )
  if (allowedRecipients.isError) return null
  if (allowedRecipients.isLoading) return null
  if (!allowedRecipients.data?.length) return null
  return (
    <>
      <Tooltip content="Donate">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            donateDialog.open({
              docId,
              authors,
              allowedRecipients: allowedRecipients.data,
            })
          }}
        >
          <CircleDollarSign className="text-brand-9 group-hover:text-brand-8 size-4" />
        </Button>
      </Tooltip>
      {donateDialog.content}
    </>
  )
}

function DonateDialog({
  input,
  onClose,
}: {
  input: {
    docId: UnpackedHypermediaId
    authors: HMMetadataPayload[]
    allowedRecipients: string[]
  }
  onClose: () => void
}) {
  const {docId, authors, allowedRecipients} = input
  const [openInvoice, setOpenInvoice] = useState<HMInvoice | null>(null)
  const allowed = new Set(allowedRecipients)

  let content = <SizableText>No available recipents to pay</SizableText>
  if (openInvoice)
    return (
      <DonateInvoice
        invoice={openInvoice}
        onReset={() => setOpenInvoice(null)}
        onClose={onClose}
      />
    )
  else if (allowed.size)
    content = (
      <DonateForm
        authors={authors}
        allowed={allowed}
        onInvoice={(invoice) => {
          setOpenInvoice(invoice)
          sendWeblnPayment(invoice.payload)
            .then(() => {
              console.log('Payment sent: ', invoice.payload, invoice.hash)
            })
            .catch((e) => {
              console.error('Error sending webln payment', e)
            })
        }}
        docId={docId}
      />
    )
  return (
    <>
      <DialogTitle>Donate to Authors</DialogTitle>
      <DialogDescription>Send Bitcoin to authors</DialogDescription>
      {content}
    </>
  )
}

function DonateInvoice({
  invoice,

  onClose,
}: {
  invoice: HMInvoice
  onReset: () => void
  onClose: () => void
}) {
  const status = useInvoiceStatus(invoice)
  const authors = Object.keys(invoice.share)
  const isSettled = status.data?.isSettled
  const isError = status.data?.isError || status.isError
  if (isSettled) {
    return (
      <>
        <DialogTitle>Thank You!</DialogTitle>
        <div className="flex flex-col items-center p-4">
          <PartyPopper size={120} />
        </div>
        <DialogDescription>
          {invoice.amount} SATS has been sent to the{' '}
          {authors.length > 1 ? 'authors' : 'author'}.
        </DialogDescription>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
      </>
    )
  }
  return (
    <>
      <DialogTitle>
        Pay Invoice to {authors.length > 1 ? 'Authors' : 'Author'}
      </DialogTitle>
      <div className="flex flex-col items-center gap-4">
        <QRCode value={invoice.payload} />
        <Tooltip content="Click to Copy Invoice Text">
          <Button
            onClick={() => {
              copyTextToClipboard(invoice.payload)
              toast.success('Copied Invoice to Clipboard')
            }}
            size="sm"
          >
            <Copy className="size-4" />
            Copy Invoice
          </Button>
        </Tooltip>
        <div className="flex justify-end">
          <AlertCircle opacity={isError ? 1 : 0} color="$red10" />
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>
    </>
  )
}

function DonateForm({
  onInvoice,
  authors,
  allowed,
  docId,
}: {
  onInvoice: (invoice: HMInvoice) => void
  authors: HMMetadataPayload[]
  allowed: Set<string>
  docId: UnpackedHypermediaId
}) {
  const [paymentAllocation, setPaymentAllocation] = useState<PaymentAllocation>(
    {
      mode: 'even',
      amount: DEFAULT_PAYMENT_AMOUNTS[0]!,
      recipients: authors
        .filter((a) => allowed.has(a.id.uid))
        .map((a) => a.id.uid),
    },
  )
  const createInvoice = useCreateInvoice()
  const {fee, recipients, total, isEven} = getAllocations(paymentAllocation)
  if (createInvoice.isLoading)
    return (
      <div className="flex flex-col items-center gap-4">
        <h2 className="text-lg font-bold">Creating Invoice</h2>
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      </div>
    )
  return (
    <>
      <h2 className="text-lg font-bold">Distribution Overview</h2>
      <Label>Total Payment (SAT)</Label>
      <Input
        value={`${total}`}
        onChange={(e) => {
          const amountText = e.target.value
          setPaymentAllocation(applyTotalAmount(amountText))
        }}
      />
      <CheckboxField
        id="split-evenly"
        checked={isEven}
        onCheckedChange={(v) =>
          setPaymentAllocation(
            applyIsEvenAllocation(v === 'indeterminate' ? false : v),
          )
        }
      >
        Divide Evenly
      </CheckboxField>
      <div className="flex flex-col">
        {authors.map((author) => {
          if (!author.metadata) return null
          const isAllowedRecipient = allowed.has(author.id.uid)
          const recieveAmount =
            recipients.find((r) => r.account === author.id.uid)?.amount || 0
          return (
            <div key={author.id.uid} className="flex justify-between">
              <div className="flex items-center gap-4">
                <HMIcon
                  id={author.id}
                  name={author.metadata?.name}
                  icon={author.metadata?.icon}
                />
                <SizableText color={isAllowedRecipient ? 'default' : 'muted'}>
                  {getMetadataName(author.metadata)}
                </SizableText>
              </div>
              {isAllowedRecipient ? (
                <Input
                  value={String(recieveAmount)}
                  onChange={(e: any) => {
                    const text =
                      'nativeEvent' in e ? e.nativeEvent.text : e.target.value
                    setPaymentAllocation(
                      applyRecipientAmount(author.id.uid, text),
                    )
                  }}
                  type="text"
                />
              ) : (
                <SizableText>Donations Disabled</SizableText>
              )}
            </div>
          )
        })}
      </div>
      <DialogDescription>Fee: {fee} SAT</DialogDescription>
      <DialogDescription>Total: {total} SAT</DialogDescription>
      <Button
        variant="default"
        onClick={() => {
          createInvoice
            .mutateAsync({
              amountSats: total,
              recipients: Object.fromEntries(
                recipients.map((recipient) => {
                  return [recipient.account, recipient.amount / total]
                }),
              ),
              docId,
            })
            .then((invoice) => {
              onInvoice(invoice)
            })
        }}
      >
        Donate
      </Button>
    </>
  )
}
