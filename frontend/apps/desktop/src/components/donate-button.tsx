import {useEntities, useEntity} from '@/models/entities'
import {
  useAllowedPaymentRecipients,
  useCreateInvoice,
  useInvoiceStatus,
} from '@/models/payments'
import {
  getAccountName,
  hmId,
  HMInvoice,
  LIGHTNING_API_URL,
  UnpackedHypermediaId,
} from '@shm/shared'
import {CheckboxField, Field, HMIcon} from '@shm/ui'
import {Spinner} from '@shm/ui/src/spinner'
import {CircleDollarSign} from '@tamagui/lucide-icons'
import {useState} from 'react'
import QRCode from 'react-qr-code'
import {
  Button,
  DialogDescription,
  Heading,
  Input,
  SizableText,
  XStack,
  YStack,
} from 'tamagui'
import {DialogTitle, useAppDialog} from './dialog'

export function DonateButton({docId}: {docId: UnpackedHypermediaId}) {
  const donateDialog = useAppDialog(DonateDialog)
  const entity = useEntity(docId)

  const allowedRecipients = useAllowedPaymentRecipients(
    entity.data?.document?.authors || [],
  )
  if (allowedRecipients.isLoading) return null
  if (!allowedRecipients.data?.length) return null
  return (
    <>
      <Button
        icon={CircleDollarSign}
        theme="green"
        onPress={() => {
          donateDialog.open(docId)
        }}
        size="$2"
      />
      {donateDialog.content}
    </>
  )
}

function DonateDialog({
  input,
  onClose,
}: {
  input: UnpackedHypermediaId
  onClose: () => void
}) {
  const entity = useEntity(input)
  const [openInvoice, setOpenInvoice] = useState<HMInvoice | null>(null)
  const allowedRecipients = useAllowedPaymentRecipients(
    entity.data?.document?.authors || [],
  )
  let content = <SizableText>No available recipents to pay</SizableText>
  if (openInvoice)
    return (
      <DonateInvoice
        invoice={openInvoice}
        onReset={() => setOpenInvoice(null)}
        onClose={onClose}
      />
    )
  if (allowedRecipients.isLoading) content = <Spinner />
  else if (allowedRecipients.data?.length)
    content = (
      <DonateForm
        allowedRecipients={allowedRecipients.data}
        onInvoice={setOpenInvoice}
        docId={input}
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
  onReset,
  onClose,
}: {
  invoice: HMInvoice
  onReset: () => void
  onClose: () => void
}) {
  console.log('~~', invoice)
  const status = useInvoiceStatus(invoice)

  return (
    <>
      <DialogTitle>pay this invoice</DialogTitle>
      <QRCode value={invoice.payload} />
      <SizableText>{status.data?.isSettled ? 'Settled' : 'Open'}</SizableText>
      <SizableText>{invoice.payload}</SizableText>
    </>
  )
}

function DonateForm({
  allowedRecipients,
  onInvoice,
  docId,
}: {
  allowedRecipients: string[]
  onInvoice: (invoice: HMInvoice) => void
  docId: UnpackedHypermediaId
}) {
  const [paymentAllocation, setPaymentAllocation] = useState<{
    evenly: boolean
    accounts?: Record<string, number>
    total: number
  }>({evenly: true, total: 100})
  const authors = useEntities(
    allowedRecipients.map((author) => hmId('d', author)) || [],
  )
  const createInvoice = useCreateInvoice()
  if (createInvoice.isLoading)
    return (
      <YStack ai="center" gap="$4">
        <Heading>Creating Invoice</Heading>
        <Spinner />
      </YStack>
    )
  return (
    <>
      <Heading>Distribution Overview</Heading>
      <Field id="username" label="Amount">
        <Input
          borderColor="$colorTransparent"
          borderWidth={0}
          value={`${paymentAllocation.total}`}
          onChangeText={(text) => {
            setPaymentAllocation((allocation) => {
              if (isNaN(Number(text))) return allocation
              return {...allocation, total: Number(text)}
            })
          }}
        />
      </Field>
      <CheckboxField
        id="split-evenly"
        value={paymentAllocation.evenly}
        onValue={(isEvenly) =>
          setPaymentAllocation((allocation) => {
            return {evenly: isEvenly, total: paymentAllocation.total}
          })
        }
      >
        Divide Evenly
      </CheckboxField>
      <YStack>
        {authors.map((author) => {
          if (!author.data) return null
          return (
            <XStack key={author.data.id.uid} jc="space-between">
              <XStack ai="center" gap="$4">
                <HMIcon
                  id={author.data.id}
                  metadata={author.data?.document?.metadata}
                />
                <SizableText>
                  {getAccountName(author.data?.document)}
                </SizableText>
              </XStack>
              <Input placeholder="0" />
            </XStack>
          )
        })}
      </YStack>
      <DialogDescription>{LIGHTNING_API_URL}</DialogDescription>
      <Button
        themeInverse
        theme="green"
        onPress={() => {
          if (!paymentAllocation.evenly)
            throw new Error('Not implemented uneven splits')
          const recipients = Object.fromEntries(
            allowedRecipients.map((authorUid) => {
              return [authorUid, 1 / allowedRecipients.length]
            }),
          )
          createInvoice
            .mutateAsync({
              amountSats: paymentAllocation.total,
              recipients,
              docId,
            })
            .then((invoice) => {
              console.log(`== ~ invoice`, invoice)
              onInvoice(invoice)
            })
        }}
      >
        Donate
      </Button>
    </>
  )
}
