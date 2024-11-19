import {DialogTitle, useAppDialog} from '@/components/dialog'
import {useCurrencyComparisons} from '@/models/compare-currencies'
import {useEntity} from '@/models/entities'
import {
  useCreateLocalInvoice,
  useCreateWallet,
  useDecodedInvoice,
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
  HMWallet,
  Invoice,
} from '@shm/shared'
import {
  Button,
  copyTextToClipboard,
  DialogDescription,
  Field,
  Heading,
  InfoListHeader,
  Input,
  SelectDropdown,
  SizableText,
  Spinner,
  TableList,
  toast,
  Tooltip,
  XStack,
  YStack,
} from '@shm/ui'
import {
  ChevronLeft,
  CircleDollarSign,
  Copy,
  Download,
  Trash,
  Upload,
} from '@tamagui/lucide-icons'
import {useState} from 'react'
import QRCode from 'react-qr-code'

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
    return wallets.data.wallets.map((wallet) => (
      <WalletButton
        walletId={wallet.id}
        onOpen={() => onOpenWallet(wallet.id)}
      />
    ))
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

function WalletButton({
  walletId,
  onOpen,
}: {
  walletId: string
  onOpen: () => void
}) {
  const wallet = useWallet(walletId)
  return (
    <Button onPress={onOpen} icon={CircleDollarSign}>
      See My Wallet - {wallet.data?.balance}
    </Button>
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
      {
        wallet.isLoading ? (
          <Spinner />
        ) : wallet.data ? (
          <WalletDetails
            wallet={wallet.data}
            walletName={walletName}
            walletId={walletId}
            accountUid={accountUid}
          />
        ) : null // todo error view
      }
      <TableList>
        <InfoListHeader title="Transaction History" />
        {invoices.data ? (
          <WalletTransactions invoices={invoices.data} />
        ) : (
          <YStack margin="$4">
            <Spinner />
          </YStack>
        )}
      </TableList>
    </YStack>
  )
}

function WalletTransactions({
  invoices,
}: {
  invoices: {
    all: PlainMessage<Invoice>[]
    received: PlainMessage<Invoice>[]
    paid: PlainMessage<Invoice>[]
  }
}) {
  if (invoices.all.length === 0)
    return (
      <YStack margin="$4">
        <SizableText color="$color9">No transactions yet.</SizableText>
      </YStack>
    )
  return (
    <YStack>
      {invoices.all.map((invoice) => (
        <InvoiceRow invoice={invoice} />
      ))}
    </YStack>
  )
}

function WalletDetails({
  wallet,
  walletName,
  walletId,
  accountUid,
}: {
  wallet: HMWallet
  walletName: string
  walletId: string
  accountUid: string
}) {
  const withdrawDialog = useAppDialog(WithdrawDialog)
  const topUpDialog = useAppDialog(TopUpDialog)

  return (
    <>
      <XStack jc="space-between" ai="center">
        <Heading fontWeight="bold">{walletName}</Heading>
        <XStack gap="$4" ai="center">
          <Heading fontFamily="$mono"></Heading>
          <WalletValue amount={Number(wallet.balance)} />
        </XStack>
      </XStack>
      <XStack jc="space-between">
        <Tooltip content="Click to Copy Lightning Address">
          <Button
            icon={Copy}
            chromeless
            color="$blue10"
            onPress={() => {
              copyTextToClipboard(walletId)
              toast.success('Copied Lightning Address to Clipboard')
            }}
          >
            {`...${wallet.id.slice(-8)}`}
          </Button>
        </Tooltip>
        <SizableText fontFamily="$mono" fontSize="$7">
          {wallet.balance ? Number(wallet.balance) : '0'} SATS
        </SizableText>
      </XStack>
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
    </>
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
  const [invoice, reset] = useDecodedInvoice(payreqInput)
  const payInvoice = usePayInvoice()
  const [isComplete, setIsComplete] = useState(false)
  if (isComplete && invoice) {
    return (
      <>
        <DialogTitle>
          Successfully sent <AmountSats amount={invoice.amount} /> to{' '}
          <DestWallet walletIds={Object.keys(invoice.share)} />
        </DialogTitle>
      </>
    )
  }
  if (invoice) {
    return (
      <>
        <DialogTitle>Send {walletName}</DialogTitle>
        <DialogDescription>
          Send <AmountSats amount={invoice.amount} /> to{' '}
          <DestWallet walletIds={Object.keys(invoice.share)} />
        </DialogDescription>
        <DialogDescription color="$color10">
          {invoice.description}
        </DialogDescription>
        <XStack marginVertical="$4" jc="center">
          <Spinner opacity={payInvoice.isLoading ? 1 : 0} />
        </XStack>
        <XStack gap="$4">
          <Button
            f={1}
            onPress={() => {
              reset()
              setPayreqInput('')
            }}
          >
            Cancel
          </Button>
          <Button
            f={1}
            themeInverse
            onPress={() => {
              payInvoice
                .mutateAsync({
                  walletId,
                  accountUid,
                  invoice,
                })
                .then(() => {
                  setIsComplete(true)
                })
            }}
          >
            Send Funds
          </Button>
        </XStack>
      </>
    )
  }
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
        <Button f={1} themeInverse disabled>
          Send Funds
        </Button>
      </XStack>
    </>
  )
}

function AmountSats({amount}: {amount: number}) {
  return <SizableText fontFamily="$mono">{amount} SATS</SizableText>
}

function DestWallet({walletIds}: {walletIds: string[]}) {
  return <SizableText fontFamily="$mono">{walletIds.join(', ')}</SizableText>
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
  const invoicePaid = useInvoiceStatus(invoice)
  if (invoicePaid.data?.isSettled) {
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

function WalletValue({amount}: {amount: number}) {
  const currencies = useCurrencyComparisons(amount || 0)
  const [activeCurrency, setActiveCurrency] =
    useState<(typeof currencies)[number]['code']>('usd')
  if (!currencies.length) return null
  const currency = currencies.find(({code}) => code === activeCurrency)
  const {value, precision, character} = currency || {value: 0, precision: 0}
  const displayValue =
    precision === 0 ? Math.round(value) : value.toFixed(precision)

  return (
    <XStack gap="$3" ai="center">
      <Heading fontFamily={'$mono'}>{`${character}${displayValue}`}</Heading>
      <SelectDropdown
        value={activeCurrency}
        onValue={setActiveCurrency}
        options={
          currencies?.map(({code, value, name, precision}) => {
            return {
              value: code,
              // label: `${name} - ${displayValue}`,
              label: name,
            }
          }) || []
        }
      />
    </XStack>
  )
}
