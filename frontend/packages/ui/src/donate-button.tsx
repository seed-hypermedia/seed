import {
  getMetadataName,
  HMInvoice,
  HMMetadataPayload,
  LIGHTNING_API_URL,
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
import {CheckboxField} from "./checkbox-field";
import {Field} from "./form-fields";
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
  const [paymentAllocation, setPaymentAllocation] = useState<{
    evenly: boolean;
    accounts?: Record<string, number>;
    total: number;
  }>({evenly: true, total: 100});
  const createInvoice = useCreateInvoice();
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
      <Field id="amount" label="Amount">
        <Input
        // borderColor="$colorTransparent"
        // id="amount"
        // borderWidth={0}
        // value={`${paymentAllocation.total}`}
        // onChange={(e) => {
        //   const text = e.target.value;
        //   setPaymentAllocation((allocation) => {
        //     if (isNaN(Number(text))) return allocation;
        //     return {...allocation, total: Number(text)};
        //   });
        // }}
        />
      </Field>
      <CheckboxField
        id="split-evenly"
        value={paymentAllocation.evenly}
        onValue={(isEvenly) =>
          setPaymentAllocation((allocation) => {
            return {evenly: isEvenly, total: paymentAllocation.total};
          })
        }
      >
        Divide Evenly
      </CheckboxField>
      <YStack>
        {authors.map((author) => {
          if (!author.metadata) return null;
          return (
            <XStack key={author.id.uid} jc="space-between">
              <XStack ai="center" gap="$4">
                <HMIcon id={author.id} metadata={author.metadata} />
                <SizableText>{getMetadataName(author.metadata)}</SizableText>
              </XStack>
              <Input placeholder="0" />
            </XStack>
          );
        })}
      </YStack>
      <DialogDescription>{LIGHTNING_API_URL}</DialogDescription>
      <Button
        themeInverse
        theme="green"
        onPress={() => {
          if (!paymentAllocation.evenly)
            throw new Error("Not implemented uneven splits");
          const recipients = Object.fromEntries(
            authors
              .filter((author) => allowed.has(author.id.uid))
              .map((authorUid) => {
                return [authorUid, 1 / allowed.size];
              })
          );
          createInvoice
            .mutateAsync({
              amountSats: paymentAllocation.total,
              recipients,
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
