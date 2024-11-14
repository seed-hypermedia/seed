import {DialogTitle, useAppDialog} from '@/components/dialog'
import {useCurrencyComparisons} from '@/models/compare-currencies'
import {useEntity} from '@/models/entities'
import {
  useCreateLocalInvoice,
  useCreateWallet,
  useDeleteWallet,
  useExportWallet,
  useInvoiceStatus,
  useListInvoices,
  useListWallets,
  usePayInvoice,
  useWallet,
} from '@/models/payments'
import {PlainMessage} from '@bufbuild/protobuf'
import {
  formattedDateMedium,
  getAccountName,
  hmId,
  HMInvoice,
  Invoice,
} from '@shm/shared'
import {
  Button,
  ButtonText,
  copyTextToClipboard,
  DialogDescription,
  Field,
  Heading,
  Input,
  SelectDropdown,
  SizableText,
  Spinner,
  toast,
  Tooltip,
  XStack,
  YStack,
} from '@shm/ui'
import {ChevronLeft, Download, Trash, Upload} from '@tamagui/lucide-icons'
import {useState} from 'react'
import QRCode from 'react-native-qrcode-svg'
import {SettingsSection} from './settings-common'

export function AccountWallet({
  accountUid,
  onOpenWallet,
}: {
  accountUid: string
  onOpenWallet: (walletId: string) => void
}) {
  const createWallet = useCreateWallet()
  const wallets = useListWallets(accountUid)
  if (!wallets.data?.wallets) return null
  if (wallets.isLoading) return <Spinner />
  if (wallets.data.wallets.length) {
    return (
      <Button
        onPress={() => {
          onOpenWallet(wallets.data.wallets[0].id)
        }}
      >
        See My Wallet
      </Button>
    )
  }
  return (
    <>
      <Button
        onPress={() => {
          createWallet.mutate({accountUid})
        }}
      >
        Create Account Wallet
      </Button>
    </>
  )
}

export function WalletPage({
  walletId,
  accountUid,
  onClose,
}: {
  walletId: string
  accountUid: string
  onClose: () => void
}) {
  const wallet = useWallet(walletId)
  const accountDoc = useEntity(hmId('d', accountUid))
  const invoices = useListInvoices(walletId)
  const exportDialog = useAppDialog(ExportWalletDialog)
  const exportWallet = useExportWallet(walletId)
  const withdrawDialog = useAppDialog(WithdrawDialog)
  const topUpDialog = useAppDialog(TopUpDialog)
  const walletName = `${getAccountName(accountDoc.data?.document)} Main Wallet`
  return (
    <YStack gap="$4">
      <XStack jc="space-between">
        <Button icon={ChevronLeft} size="$2" onPress={onClose}>
          Profile
        </Button>
        <XStack gap="$3">
          {/* <DeleteWalletButton
            walletId={walletId}
            accountUid={accountUid}
            onDeleted={onClose}
            /> */}
          <Button
            size="$2"
            onPress={() =>
              exportWallet.mutateAsync().then((exportedWallet) => {
                // toast.success('Wallet exported: ' + exportedWallet)
                exportDialog.open(exportedWallet)
              })
            }
          >
            Export
          </Button>
          {exportDialog.content}
        </XStack>
      </XStack>
      <XStack jc="space-between" ai="center">
        <Heading>{walletName}</Heading>
        <XStack gap="$4" ai="center">
          <Heading fontFamily="$mono">
            {wallet.data?.balance ? Number(wallet.data?.balance) : '0'} SATS
          </Heading>
          <CurrencyConversion amount={Number(wallet.data?.balance)} />
        </XStack>
      </XStack>
      <Tooltip content="Click to Copy Lightning Address">
        <ButtonText
          color="$blue10"
          onPress={() => {
            copyTextToClipboard(walletId)
            toast.success('Copied Lightning Address to Clipboard')
          }}
        >
          {wallet.data?.id}
        </ButtonText>
      </Tooltip>
      <XStack gap="$4">
        <Button
          icon={Download}
          themeInverse
          f={1}
          size="$3"
          onPress={() => {
            topUpDialog.open({walletId, accountUid, walletName})
          }}
        >
          Top Up
        </Button>
        {topUpDialog.content}
        <Button
          icon={Upload}
          themeInverse
          f={1}
          size="$3"
          onPress={() => {
            withdrawDialog.open({walletId, accountUid, walletName})
          }}
        >
          Withdraw
        </Button>
        {withdrawDialog.content}
      </XStack>
      <SettingsSection title="Transactions">
        <YStack>
          {invoices.data?.all.map((invoice) => (
            <InvoiceRow invoice={invoice} />
          ))}
        </YStack>
      </SettingsSection>
    </YStack>
  )
}

function WithdrawDialog({
  input,
  onClose,
}: {
  input: {walletId: string; walletName: string; accountUid: string}
  onClose: () => void
}) {
  const {walletId, accountUid, walletName} = input
  const [payreqInput, setPayreqInput] = useState('')
  const payInvoice = usePayInvoice()

  return (
    <>
      <DialogTitle>Withdraw from {walletName}</DialogTitle>
      <DialogDescription>
        Paste the invoice payment request here, and this wallet will send the
        funds.
      </DialogDescription>
      <Field id="payreq" label="Payment Request">
        <Input value={payreqInput} onChangeText={setPayreqInput} />
      </Field>
      <XStack gap="$4">
        <Button f={1} onPress={onClose}>
          Cancel
        </Button>
        <Button
          f={1}
          themeInverse
          onPress={() => {
            payInvoice
              .mutateAsync({walletId, accountUid, payreq: payreqInput})
              .then(() => {})
          }}
        >
          Send Funds
        </Button>
      </XStack>
    </>
  )
}

function TopUpDialog({
  input,
  onClose,
}: {
  input: {walletId: string; walletName: string; accountUid: string}
  onClose: () => void
}) {
  const {walletId, accountUid, walletName} = input
  const createInvoice = useCreateLocalInvoice()
  const [invoice, setInvoice] = useState<HMInvoice | null>(null)
  const [amount, setAmount] = useState(1000)
  if (invoice)
    return (
      <InvoiceInfo
        accountUid={accountUid}
        invoice={invoice}
        onCancel={onClose}
        walletName={walletName}
        walletId={walletId}
      />
    )
  return (
    <>
      <DialogTitle>Add Funds to {walletName}</DialogTitle>
      <Field id="amount" label="Amount (Sats)">
        <Input
          // type="number"
          value={`${amount}`}
          onChangeText={(text) => {
            if (Number.isNaN(Number(text))) return
            setAmount(Number(text))
          }}
        />
      </Field>
      <XStack gap="$4">
        <Button f={1} onPress={onClose}>
          Cancel
        </Button>
        <Button
          f={1}
          themeInverse
          onPress={() => {
            createInvoice
              .mutateAsync({walletId, amount: BigInt(amount)})
              .then((localInvoice) => {
                setInvoice(localInvoice)
              })
          }}
        >
          Create Invoice
        </Button>
      </XStack>
    </>
  )
}

function InvoiceInfo({
  invoice,
  accountUid,
  onCancel,
  walletName,
  walletId,
}: {
  invoice: HMInvoice
  accountUid: string
  onCancel: () => void
  walletName: string
  walletId: string
}) {
  const invoicePaid = useInvoiceStatus({
    invoiceHash: invoice.hash,
    accountUid,
    walletId,
  })
  if (invoicePaid.data?.status === 'settled') {
    return (
      <>
        <DialogTitle>Invoice Complete</DialogTitle>
        <DialogDescription>
          {invoice.amount} SATS have been transferred to {walletName}.
        </DialogDescription>
        <Button onPress={onCancel}>Done</Button>
      </>
    )
  }
  console.log('=== ', invoicePaid)

  return (
    <>
      <DialogTitle>Add Funds with External Wallet</DialogTitle>
      <QRCode value={invoice.payload} />
      <SizableText>{invoice.payload}</SizableText>
      <Button onPress={onCancel}>Cancel</Button>
    </>
  )
}

function ExportWalletDialog({
  input,
  onClose,
}: {
  input: string
  onClose: () => void
}) {
  return (
    <>
      <DialogTitle>Wallet Exported</DialogTitle>
      <DialogDescription>
        Your wallet has been exported. Here is the credentials: {input}
      </DialogDescription>
      <Button onPress={onClose}>Done</Button>
    </>
  )
}

function DeleteWalletButton({
  walletId,
  accountUid,
  onDeleted,
}: {
  walletId: string
  accountUid: string
  onDeleted: () => void
}) {
  const deleteWallet = useDeleteWallet()
  return (
    <Button
      theme="red"
      icon={Trash}
      onPress={() =>
        deleteWallet
          .mutateAsync({walletId, accountUid})
          .then(() => {
            onDeleted()
            toast.success('Wallet deleted')
          })
          .catch((e) => {
            console.error(e)
            toast.error('Failed to delete wallet')
          })
      }
    >
      Delete Wallet
    </Button>
  )
}

function InvoiceRow({invoice}: {invoice: PlainMessage<Invoice>}) {
  console.log('=== ', invoice)
  return (
    <XStack>
      <SizableText>{invoice.status}</SizableText>
      <SizableText>{Number(invoice.amount)} sats</SizableText>
      <SizableText>
        {formattedDateMedium(new Date(invoice.settledAt))}
      </SizableText>
    </XStack>
  )
}

function CurrencyConversion({amount}: {amount: number}) {
  const currencies = useCurrencyComparisons(amount || 0)
  const [val, setVal] = useState<(typeof currencies)[number]['code']>('usd')
  return (
    <SelectDropdown
      value={val}
      onValue={setVal}
      options={
        currencies?.map(({code, value, name}) => ({
          value: code,
          label: `${name} - ${value}`,
        })) || []
      }
    />
  )
}
