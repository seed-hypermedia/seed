import {DialogTitle, useAppDialog} from '@/components/dialog'
import {useCurrencyComparisons} from '@/models/compare-currencies'
import {
  useCreateLocalInvoice,
  useCreateWallet,
  useDeleteWallet,
  useExportWallet,
  useInvoiceStatus,
  useListInvoices,
  useListWallets,
  useWallet,
} from '@/models/payments'
import {PlainMessage} from '@bufbuild/protobuf'
import {formattedDateMedium, Invoice} from '@shm/shared'
import {
  Button,
  DialogDescription,
  Field,
  Heading,
  Input,
  SelectDropdown,
  SizableText,
  Spinner,
  toast,
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
  const invoices = useListInvoices(walletId)
  const exportDialog = useAppDialog(ExportWalletDialog)
  const exportWallet = useExportWallet(walletId)
  const withdrawDialog = useAppDialog(WithdrawDialog)
  const topUpDialog = useAppDialog(TopUpDialog)
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
      <XStack jc="space-between">
        <Heading>{wallet.data?.id}</Heading>
        <XStack gap="$4">
          <Heading>
            {wallet.data?.balance ? Number(wallet.data?.balance) : '0'} SATS
          </Heading>
          <CurrencyConversion amount={Number(wallet.data?.balance)} />
        </XStack>
      </XStack>
      <XStack gap="$4">
        <Button
          icon={Download}
          themeInverse
          f={1}
          onPress={() => {
            topUpDialog.open(walletId)
          }}
        >
          Top Up
        </Button>
        {topUpDialog.content}
        <Button
          icon={Upload}
          themeInverse
          f={1}
          onPress={() => {
            withdrawDialog.open(walletId)
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
  input: string
  onClose: () => void
}) {
  return (
    <>
      <DialogTitle>Withdraw from WalletNAME</DialogTitle>
    </>
  )
}

function TopUpDialog({input, onClose}: {input: string; onClose: () => void}) {
  const createInvoice = useCreateLocalInvoice()
  const [invoice, setInvoice] = useState<string | null>(null)
  const [amount, setAmount] = useState(1000)
  const invoicePaid = useInvoiceStatus()
  if (invoice)
    return (
      <>
        <DialogTitle>Pay invoice with external wallet</DialogTitle>
        <QRCode value={invoice} />
        <SizableText>{invoice}</SizableText>
        <Button
          onPress={() => {
            onClose()
          }}
        >
          Cancel
        </Button>
      </>
    )
  return (
    <>
      <DialogTitle>Add Funds to WalletNAME</DialogTitle>
      <Field id="amount" label="Amount">
        <Input
          // type="number"
          value={`${amount}`}
          onChangeText={(text) => {
            if (Number.isNaN(Number(text))) return
            setAmount(Number(text))
          }}
        />
      </Field>
      <Button
        onPress={() => {
          createInvoice
            .mutateAsync({walletId: input, amount: BigInt(amount)})
            .then((payreq) => {
              setInvoice(payreq)
            })
          // onClose()
        }}
      />
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
