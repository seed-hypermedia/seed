import {DialogTitle, useAppDialog} from '@/components/dialog'
import {useCurrencyComparisons} from '@/models/compare-currencies'
import {
  useCreateLocalInvoice,
  useCreateWallet,
  useDecodedInvoice,
  useDeleteWallet,
  useExportWallet,
  useListInvoices,
  useListWallets,
  usePayInvoice,
  useWallet,
} from '@/models/payments'
import {PlainMessage} from '@bufbuild/protobuf'
import {Invoice} from '@shm/shared/client/.generated/payments/v1alpha/invoices_pb'
import {getAccountName} from '@shm/shared/content'
import {HMInvoice, HMWallet} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {useInvoiceStatus} from '@shm/shared/models/payments'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Field} from '@shm/ui/form-fields'
import {
  AlertCircle,
  ChevronDown,
  Back as ChevronLeft,
  Forward as ChevronRight,
  ChevronUp,
  Copy,
  Download,
  Trash,
  Upload,
} from '@shm/ui/icons'
import {Button} from '@shm/ui/legacy/button'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {InfoListHeader, TableList} from '@shm/ui/table-list'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useState} from 'react'
import QRCode from 'react-qr-code'
import {
  ButtonText,
  DialogDescription,
  Form,
  Heading,
  Input,
  SizableText,
  View,
  XStack,
  YStack,
} from 'tamagui'

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
  if (wallets.isLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  if (createWallet.isLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
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
        themeInverse
        onPress={() => {
          createWallet.mutateAsync({accountUid}).catch((e) => {
            console.error(e)
            toast.error(`Failed to create wallet: ${e.message}`)
          })
        }}
      >
        Create Account Wallet
      </Button>
    </>
  )
}

function Tag({label}: {label: string}) {
  return (
    <View
      borderWidth={1}
      borderColor="$brand5"
      paddingHorizontal="$2"
      borderRadius="$2"
    >
      <SizableText size="$1" color="$brand5">
        {label}
      </SizableText>
    </View>
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
    <Button onPress={onOpen}>
      <XStack f={1} jc="space-between" ai="center">
        <SizableText fontFamily="$mono">
          x{walletId.slice(-8).toUpperCase()}
        </SizableText>
        <XStack ai="center" gap="$3">
          <Tag label="Account Wallet" />
          {wallet.isLoading ? (
            <div className="flex items-center justify-center">
              <Spinner />
            </div>
          ) : wallet.data ? (
            <SizableText
              fontFamily="$mono"
              fontWeight="bold"
            >{`${wallet.data?.balance} SAT`}</SizableText>
          ) : wallet.isError ? (
            <AlertCircle color="$red10" size={16} />
          ) : null}
          <ChevronRight color="$brand5" size={16} />
        </XStack>
      </XStack>
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
            color="$brand5"
            borderColor="$brand5"
            borderWidth={1}
            hoverStyle={{borderColor: '$brand3'}}
          >
            Export
          </Button>
          {exportDialog.content}
        </XStack>
      </XStack>
      {
        wallet.isLoading ? (
          <div className="flex items-center justify-center">
            <Spinner />
          </div>
        ) : wallet.isError ? (
          <YStack margin="$4">
            <Heading fontWeight="bold" color="$red10">
              Error Loading Wallet
            </Heading>
          </YStack>
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
        ) : invoices.isError ? (
          <YStack margin="$4">
            <SizableText color="$red10">
              Error Loading Transaction History. May be disconnected from Seed
              Lightning Server.
            </SizableText>
          </YStack>
        ) : (
          <div className="flex items-center justify-center m-4">
            <Spinner />
          </div>
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
  const addFundsDialog = useAppDialog(AddFundsDialog)

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
            padding="$0"
            size="$2"
            chromeless
            fontFamily="$mono"
            color="$blue10"
            onPress={() => {
              copyTextToClipboard(walletId)
              toast.success('Copied Lightning Address to Clipboard')
            }}
          >
            {`x${wallet.id.slice(-8).toUpperCase()}`}
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
            addFundsDialog.open({walletId, accountUid, walletName})
          }}
        >
          Add Funds
        </Button>
        {addFundsDialog.content}
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
          <Spinner hide={!payInvoice.isLoading} />
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
                .catch((e) => {
                  console.error(e)
                  toast.error(`Failed to send funds: ${e.message}`)
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
  return (
    <Tooltip content="Copy Wallet Address">
      <ButtonText
        fontFamily="$mono"
        onPress={() => {
          copyTextToClipboard(walletIds.join(', '))
          toast.success('Copied Destination Wallet Address to Clipboard')
        }}
      >
        {walletIds
          .map((walletId) => `x${walletId.slice(-8).toUpperCase()}`)
          .join(', ')}
      </ButtonText>
    </Tooltip>
  )
}

function AddFundsDialog({
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
  function submit() {
    createInvoice
      .mutateAsync({
        walletId,
        amount: BigInt(amount),
        description: `Add Funds to ${walletName}`,
      })
      .then((localInvoice) => {
        setInvoice(localInvoice)
      })
  }
  return (
    <>
      <DialogTitle>Add Funds to {walletName}</DialogTitle>
      <Form onSubmit={submit}>
        <YStack gap="$4">
          <Field id="amount" label="Amount (Sats)">
            <Input
              // type="number"
              id="amount"
              value={`${amount}`}
              onChangeText={(text) => {
                if (Number.isNaN(Number(text))) return
                setAmount(Number(text))
              }}
              onSubmitEditing={submit}
            />
          </Field>
          <XStack jc="center">
            <Spinner hide={!createInvoice.isLoading} />
          </XStack>
          <XStack gap="$4">
            <Button f={1} onPress={onClose}>
              Cancel
            </Button>
            <Form.Trigger asChild>
              <Button f={1} themeInverse onPress={submit}>
                Create Invoice
              </Button>
            </Form.Trigger>
          </XStack>
        </YStack>
      </Form>
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

  return (
    <>
      <DialogTitle>Add Funds with External Wallet</DialogTitle>
      <DialogDescription>
        Scan this code to pay with your lightning wallet, or copy and paste the
        invoice text.
      </DialogDescription>
      <YStack ai="center" gap="$4">
        <QRCode value={invoice.payload} />
        <Tooltip content="Click to Copy Invoice Text">
          <Button
            onPress={() => {
              copyTextToClipboard(invoice.payload)
              toast.success('Copied Invoice to Clipboard')
            }}
            icon={Copy}
            size="$2"
            themeInverse
          >
            Copy Invoice
          </Button>
        </Tooltip>
      </YStack>
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
  const isPaid = invoice.type === 'paid_invoice'
  const Chevron = isPaid ? ChevronUp : ChevronDown
  const paymentColor = isPaid ? '$red9' : '$green9'
  return (
    <XStack jc="space-between" paddingHorizontal="$4" paddingVertical="$2">
      <YStack gap="$1">
        <SizableText>
          {formattedDateMedium(new Date(invoice.settledAt))}
        </SizableText>
        <SizableText>
          {invoice.description ? (
            <SizableText fontWeight="bold">{invoice.description} </SizableText>
          ) : null}
          <Tooltip content="Click to Copy Destination Address">
            <ButtonText
              color="$blue10"
              fontFamily="$mono"
              onPress={() => {
                copyTextToClipboard(invoice.destination)
                toast.success('Copied Destination Address to Clipboard')
              }}
            >
              {`x${invoice.destination.slice(-8).toUpperCase()}`}
            </ButtonText>
          </Tooltip>
        </SizableText>
      </YStack>
      <YStack gap="$3">
        <XStack gap="$2">
          <SizableText fontFamily="$mono" color={paymentColor}>
            {Number(invoice.amount)} SATS
          </SizableText>
          <Chevron color={paymentColor} size={18} />
        </XStack>
      </YStack>
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
