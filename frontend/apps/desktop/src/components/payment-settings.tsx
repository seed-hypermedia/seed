import {DialogDescription, DialogTitle, useAppDialog} from '@/components/dialog'
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
} from '@/models/crypto-payments'
import {
  useCreateAccountLink,
  useCreateExpressPortalLink,
  useGetAccountBalance,
  useGetConnectedAccount,
  useNewConnectedAccount,
} from '@/models/fiat-payments'
import {PlainMessage} from '@bufbuild/protobuf'
import {Invoice} from '@shm/shared/client/.generated/payments/v1alpha/invoices_pb'
import {getAccountName} from '@shm/shared/content'
import {HMInvoice, HMWallet} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {useInvoiceStatus} from '@shm/shared/models/payments'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {Badge} from '@shm/ui/components/badge'
import {Input} from '@shm/ui/components/input'
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
  Upload,
} from '@shm/ui/icons'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {InfoListHeader, TableList} from '@shm/ui/table-list'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useEffect, useState} from 'react'
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
        variant="inverse"
        onClick={() => {
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

export function StripeAccount({
  accountUid,
  url,
}: {
  accountUid: string
  url: string
}) {
  const newAccount = useNewConnectedAccount()
  const createAccountLink = useCreateAccountLink()
  const getExpressPortalLink = useCreateExpressPortalLink()
  const getAccount = useGetConnectedAccount()
  const getAccountBalance = useGetAccountBalance()
  const [accountExists, setAccountExists] = useState(false)
  useEffect(() => {
    getAccount
      .mutateAsync({accountUid})
      .then((res) => {
        if (res.account?.detailsSubmitted === true) {
          setAccountExists(true)
        } else {
          setAccountExists(false)
        }
      })
      .then(() => {
        getAccountBalance.mutateAsync({accountUid}).catch((e) => {
          console.error(e)
          toast.error(`Failed to retrieve account balance: ${e.message}`)
        })
      })
      .catch((e) => {
        setAccountExists(false)
      })
  }, [accountUid, accountExists])
  if (accountExists) {
    return (
      //TODO Create two columns one for the account details and one for the button
      <div className="flex flex-1 items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="inverse"
            onClick={() => {
              getExpressPortalLink
                .mutateAsync({
                  accountUid,
                })
                .then((link) => {
                  window.open(link.url, '_blank')
                })
                .catch((e) => {
                  toast.error('Failed to retrieve express link')
                })
            }}
          >
            Access Express Dashboard
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <SizableText size="$1" color="$brand5">
            Account Balance:
          </SizableText>
          <SizableText size="$1" color="$brand5">
            {getAccountBalance.data?.available[0]?.amount.toFixed(2) || '0.00'}{' '}
            {getAccountBalance.data?.available[0]?.currency.toUpperCase() ||
              'USD'}
          </SizableText>
        </div>
      </div>
    )
  }
  return (
    <>
      <Button
        variant="inverse"
        onClick={() => {
          createAccountLink
            .mutateAsync({
              accountUid,
              refreshUrl: `${url}`,
              returnUrl: `${url}`,
            })
            .then((link) => {
              if (link) {
                window.open(link.url, '_blank')
              } else {
                toast.error('Failed to retrieve account link')
              }
            })
            .catch((e) => {
              newAccount
                .mutateAsync({accountUid, url})
                .then(() => {
                  createAccountLink
                    .mutateAsync({
                      accountUid,
                      refreshUrl: `${url}`,
                      returnUrl: `${url}`,
                    })
                    .then((link) => {
                      if (link) {
                        window.open(link.url, '_blank')
                      } else {
                        toast.error('Failed to retrieve account link')
                      }
                    })
                })
                .catch((e) => {
                  console.error(e)
                  toast.error(
                    `Failed to create connected account: ${e.message}`,
                  )
                })
            })
        }}
      >
        Create connected account
      </Button>
    </>
  )
}

function Tag({label}: {label: string}) {
  return (
    <div className="border-primary rounded-sm border px-2">
      <SizableText size="$1" color="$brand5">
        {label}
      </SizableText>
    </div>
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
    <Button onClick={onOpen}>
      <div className="flex flex-1 items-center justify-between">
        <SizableText family="mono">
          x{walletId.slice(-8).toUpperCase()}
        </SizableText>
        <div className="flex items-center gap-3">
          <Badge variant="outline">Account Wallet</Badge>
          {wallet.isLoading ? (
            <div className="flex items-center justify-center">
              <Spinner />
            </div>
          ) : wallet.data ? (
            <SizableText
              family="mono"
              weight="bold"
            >{`${wallet.data?.balance} SAT`}</SizableText>
          ) : wallet.isError ? (
            <AlertCircle className="text-destructive size-4" />
          ) : null}
          <ChevronRight className="text-primary size-4" />
        </div>
      </div>
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
    <div className="flex flex-col gap-4">
      <div className="flex justify-between">
        <Button size="sm" onClick={onClose}>
          <ChevronLeft className="size-4" />
          Profile
        </Button>
        <div className="flex gap-3">
          {/* <DeleteWalletButton
            walletId={walletId}
            accountUid={accountUid}
            onDeleted={onClose}
            /> */}
          <Button
            size="sm"
            onClick={() =>
              exportWallet.mutateAsync().then((exportedWallet) => {
                // toast.success('Wallet exported: ' + exportedWallet)
                exportDialog.open(exportedWallet)
              })
            }
            variant="outline"
            className="text-primary border-primary border"
          >
            Export
          </Button>
          {exportDialog.content}
        </div>
      </div>
      {
        wallet.isLoading ? (
          <div className="flex items-center justify-center">
            <Spinner />
          </div>
        ) : wallet.isError ? (
          <div className="m-4 flex flex-col">
            <SizableText weight="bold" size="2xl" className="text-destructive">
              Error Loading Wallet
            </SizableText>
          </div>
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
          <div className="m-4 flex flex-col">
            <SizableText className="text-destructive">
              Error Loading Transaction History. May be disconnected from Seed
              Lightning Server.
            </SizableText>
          </div>
        ) : (
          <div className="m-4 flex items-center justify-center">
            <Spinner />
          </div>
        )}
      </TableList>
    </div>
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
      <div className="m-4 flex flex-col">
        <SizableText className="text-muted">No transactions yet.</SizableText>
      </div>
    )
  return (
    <div className="flex flex-col">
      {invoices.all.map((invoice) => (
        <InvoiceRow invoice={invoice} />
      ))}
    </div>
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
      <div className="flex items-center justify-between">
        <SizableText weight="bold" size="2xl">
          {walletName}
        </SizableText>
        <div className="flex items-center gap-4">
          <WalletValue amount={Number(wallet.balance)} />
        </div>
      </div>
      <div className="flex justify-between">
        <Tooltip content="Click to Copy Lightning Address">
          <Button
            size="sm"
            onClick={() => {
              copyTextToClipboard(walletId)
              toast.success('Copied Lightning Address to Clipboard')
            }}
            className="text-blue-500"
          >
            <Copy className="size-4" />
            <SizableText family="mono" className="text-current">{`x${wallet.id
              .slice(-8)
              .toUpperCase()}`}</SizableText>
          </Button>
        </Tooltip>
        <SizableText family="mono" size="2xl">
          {wallet.balance ? Number(wallet.balance) : '0'} SATS
        </SizableText>
      </div>
      <div className="flex gap-4">
        <Button
          className="flex-1"
          size="sm"
          onClick={() => {
            addFundsDialog.open({walletId, accountUid, walletName})
          }}
        >
          <Download className="size-4" />
          Add Funds
        </Button>
        {addFundsDialog.content}
        <Button
          className="flex-1"
          size="sm"
          onClick={() => {
            withdrawDialog.open({walletId, accountUid, walletName})
          }}
        >
          <Upload className="size-4" />
          Withdraw
        </Button>
        {withdrawDialog.content}
      </div>
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
        <div className="my-4 flex justify-center">
          <Spinner hide={!payInvoice.isLoading} />
        </div>
        <div className="flex gap-4">
          <Button
            className="flex-1"
            onClick={() => {
              reset()
              setPayreqInput('')
            }}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
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
        </div>
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
      <div className="flex gap-4">
        <Button className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button className="flex-1" disabled>
          Send Funds
        </Button>
      </div>
    </>
  )
}

function AmountSats({amount}: {amount: number}) {
  return <SizableText family="mono">{amount} SATS</SizableText>
}

function DestWallet({walletIds}: {walletIds: string[]}) {
  return (
    <Tooltip content="Copy Wallet Address">
      <Button
        variant="link"
        onClick={() => {
          copyTextToClipboard(walletIds.join(', '))
          toast.success('Copied Destination Wallet Address to Clipboard')
        }}
      >
        {walletIds
          .map((walletId) => `x${walletId.slice(-8).toUpperCase()}`)
          .join(', ')}
      </Button>
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
      <form onSubmit={submit}>
        <div className="flex flex-col gap-4">
          <Field id="amount" label="Amount (Sats)">
            <Input
              // type="number"
              id="amount"
              value={`${amount}`}
              onChangeText={(text) => {
                if (Number.isNaN(Number(text))) return
                setAmount(Number(text))
              }}
              // onSubmitEditing={submit}
            />
          </Field>
          <div className="flex justify-center">
            <Spinner hide={!createInvoice.isLoading} />
          </div>
          <div className="flex gap-4">
            <Button className="flex-1" onClick={onClose}>
              Cancel
            </Button>

            <Button type="submit" className="flex-1" onClick={submit}>
              Create Invoice
            </Button>
          </div>
        </div>
      </form>
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
        <Button onClick={onCancel}>Done</Button>
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
      </div>
      <Button onClick={onCancel}>Cancel</Button>
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
      <Button onClick={onClose}>Done</Button>
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
      variant="destructive"
      onClick={() =>
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
    <div className="flex justify-between px-4 py-2">
      <div className="flex flex-col gap-1">
        <SizableText>
          {formattedDateMedium(new Date(invoice.settledAt))}
        </SizableText>
        <SizableText>
          {invoice.description ? (
            <SizableText weight="bold">{invoice.description} </SizableText>
          ) : null}
          <Tooltip content="Click to Copy Destination Address">
            <Button
              variant="blue"
              onClick={() => {
                copyTextToClipboard(invoice.destination)
                toast.success('Copied Destination Address to Clipboard')
              }}
            >
              {`x${invoice.destination.slice(-8).toUpperCase()}`}
            </Button>
          </Tooltip>
        </SizableText>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <SizableText family="mono" style={{color: paymentColor}}>
            {Number(invoice.amount)} SATS
          </SizableText>
          <Chevron color={paymentColor} size={18} />
        </div>
      </div>
    </div>
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
    <div className="flex items-center gap-3">
      <SizableText
        size="2xl"
        family="mono"
      >{`${character}${displayValue}`}</SizableText>
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
    </div>
  )
}
