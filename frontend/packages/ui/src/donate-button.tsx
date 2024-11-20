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
} from "@shm/shared";
import {Button} from "@tamagui/button";
import {DialogDescription} from "@tamagui/dialog";
import {Input} from "@tamagui/input";
import {Label} from "@tamagui/label";
import {CircleDollarSign, Copy, PartyPopper} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {Heading, SizableText} from "@tamagui/text";
import {useState} from "react";
import QRCode from "react-qr-code";
import {CheckboxField} from "./checkbox-field";
import {copyTextToClipboard} from "./copy-to-clipboard";
import {HMIcon} from "./hm-icon";
import {Spinner} from "./spinner";
import {toast} from "./toast";
import {Tooltip} from "./tooltip";
import {DialogTitle, useAppDialog} from "./universal-dialog";

export function DonateButton({
  docId,
  authors,
}: {
  docId: UnpackedHypermediaId;
  authors: HMMetadataPayload[];
}) {
  const donateDialog = useAppDialog(DonateDialog);
  const allowedRecipients = useAllowedPaymentRecipients(
    authors.map((author) => author.id.uid) || []
  );
  if (allowedRecipients.isLoading) return null;
  if (!allowedRecipients.data?.length) return null;
  return (
    <>
      <Button
        icon={CircleDollarSign}
        theme="green"
        onPress={() => {
          donateDialog.open({
            docId,
            authors,
            allowedRecipients: allowedRecipients.data,
          });
        }}
        size="$2"
      />
      {donateDialog.content}
    </>
  );
}

function DonateDialog({
  input,
  onClose,
}: {
  input: {
    docId: UnpackedHypermediaId;
    authors: HMMetadataPayload[];
    allowedRecipients: string[];
  };
  onClose: () => void;
}) {
  const {docId, authors, allowedRecipients} = input;
  const [openInvoice, setOpenInvoice] = useState<HMInvoice | null>(null);
  const allowed = new Set(allowedRecipients);

  let content = <SizableText>No available recipents to pay</SizableText>;
  if (openInvoice)
    return (
      <DonateInvoice
        invoice={openInvoice}
        onReset={() => setOpenInvoice(null)}
        onClose={onClose}
      />
    );
  else if (allowed.size)
    content = (
      <DonateForm
        authors={authors}
        allowed={allowed}
        onInvoice={setOpenInvoice}
        docId={docId}
      />
    );
  return (
    <>
      <DialogTitle>Donate to Authors</DialogTitle>
      <DialogDescription>Send Bitcoin to authors</DialogDescription>
      {content}
    </>
  );
}

function DonateInvoice({
  invoice,
  onReset,
  onClose,
}: {
  invoice: HMInvoice;
  onReset: () => void;
  onClose: () => void;
}) {
  const status = useInvoiceStatus(invoice);
  const authors = Object.keys(invoice.share);
  const isSettled = status.data?.isSettled;
  if (isSettled) {
    return (
      <>
        <DialogTitle>Thank You!</DialogTitle>
        <YStack ai="center" padding="$4">
          <PartyPopper size={120} />
        </YStack>
        <DialogDescription>
          {invoice.amount} SATS has been sent to the{" "}
          {authors.length > 1 ? "authors" : "author"}.
        </DialogDescription>
        <Button onPress={onClose}>Done</Button>
      </>
    );
  }
  return (
    <>
      <DialogTitle>
        Pay Invoice to {authors.length > 1 ? "Authors" : "Author"}
      </DialogTitle>
      <YStack ai="center" gap="$4">
        <QRCode value={invoice.payload} />
        <Tooltip content="Click to Copy Invoice Text">
          <Button
            onPress={() => {
              copyTextToClipboard(invoice.payload);
              toast.success("Copied Invoice to Clipboard");
            }}
            icon={Copy}
            size="$2"
            themeInverse
          >
            Copy Invoice
          </Button>
        </Tooltip>
      </YStack>
      <Button onPress={onClose}>Cancel</Button>
    </>
  );
}

function DonateForm({
  onInvoice,
  authors,
  allowed,
  docId,
}: {
  onInvoice: (invoice: HMInvoice) => void;
  authors: HMMetadataPayload[];
  allowed: Set<string>;
  docId: UnpackedHypermediaId;
}) {
  const [paymentAllocation, setPaymentAllocation] = useState<PaymentAllocation>(
    {
      mode: "even",
      amount: DEFAULT_PAYMENT_AMOUNTS[0],
      recipients: authors
        .filter((a) => allowed.has(a.id.uid))
        .map((a) => a.id.uid),
    }
  );
  const createInvoice = useCreateInvoice();
  const {fee, recipients, total, isEven} = getAllocations(paymentAllocation);
  if (createInvoice.isLoading)
    return (
      <YStack ai="center" gap="$4">
        <Heading>Creating Invoice</Heading>
        <Spinner />
      </YStack>
    );
  return (
    <>
      <Heading>Distribution Overview</Heading>
      <Label>Total Payment (SAT)</Label>
      <Input
        // borderColor="$colorTransparent"
        // id="amount"
        // borderWidth={0}
        value={`${total}`}
        onChange={(e) => {
          const amountText = e.target.value;
          setPaymentAllocation(applyTotalAmount(amountText));
        }}
      />
      <CheckboxField
        id="split-evenly"
        value={isEven}
        onValue={(isEvenly) =>
          setPaymentAllocation(applyIsEvenAllocation(isEvenly))
        }
      >
        Divide Evenly
      </CheckboxField>
      <YStack>
        {authors.map((author) => {
          if (!author.metadata) return null;
          const isAllowedRecipient = allowed.has(author.id.uid);
          const recieveAmount =
            recipients.find((r) => r.account === author.id.uid)?.amount || 0;
          return (
            <XStack key={author.id.uid} jc="space-between">
              <XStack ai="center" gap="$4">
                <HMIcon id={author.id} metadata={author.metadata} />
                <SizableText color={isAllowedRecipient ? undefined : "$color9"}>
                  {getMetadataName(author.metadata)}
                </SizableText>
              </XStack>
              {isAllowedRecipient ? (
                <Input
                  value={`${recieveAmount}`}
                  onChange={(e) => {
                    const amountText = e.target.value;
                    setPaymentAllocation(
                      applyRecipientAmount(author.id.uid, amountText)
                    );
                  }}
                />
              ) : (
                <SizableText>Donations Disabled</SizableText>
              )}
            </XStack>
          );
        })}
      </YStack>
      <DialogDescription>Fee: {fee} SAT</DialogDescription>
      <DialogDescription>Total: {total} SAT</DialogDescription>
      <Button
        themeInverse
        theme="green"
        onPress={() => {
          createInvoice
            .mutateAsync({
              amountSats: total,
              recipients: Object.fromEntries(
                recipients.map((recipient) => {
                  return [recipient.account, recipient.amount / total];
                })
              ),
              docId,
            })
            .then((invoice) => {
              onInvoice(invoice);
            });
        }}
      >
        Donate
      </Button>
    </>
  );
}
