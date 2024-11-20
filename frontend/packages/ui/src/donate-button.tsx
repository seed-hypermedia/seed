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
import {CircleDollarSign} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {Heading, SizableText} from "@tamagui/text";
import {useState} from "react";
import QRCode from "react-qr-code";
import {Label} from "tamagui";
import {CheckboxField} from "./checkbox-field";
import {HMIcon} from "./hm-icon";
import {Spinner} from "./spinner";
import {DialogTitle, useAppDialog} from "./universal-dialog";

export function DonateButton({
  docId,
  authors,
}: {
  docId: UnpackedHypermediaId;
  authors: HMMetadataPayload[];
}) {
  const donateDialog = useAppDialog(DonateDialog);
  console.log("== hellooo", docId, authors);
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
  console.log("~~", invoice);
  const status = useInvoiceStatus(invoice);

  return (
    <>
      <DialogTitle>pay this invoice</DialogTitle>
      <QRCode value={invoice.payload} />
      <SizableText>{status.data?.isSettled ? "Settled" : "Open"}</SizableText>
      <SizableText>{invoice.payload}</SizableText>
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
                  return [recipient, recipient.amount / total];
                })
              ),
              docId,
            })
            .then((invoice) => {
              console.log(`== ~ invoice`, invoice);
              onInvoice(invoice);
            });
        }}
      >
        Donate
      </Button>
    </>
  );
}
