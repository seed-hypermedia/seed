import {zodResolver} from "@hookform/resolvers/zod";
import {encode as cborEncode} from "@ipld/dag-cbor";
import CommentEditor from "@shm/editor/comment-editor";
import {
  HMAnnotation,
  HMBlockNode,
  HMDocumentOperation,
  hmId,
  hmIdPathToEntityQueryPath,
  HMPublishableAnnotation,
  HMPublishableBlock,
  hostnameStripProtocol,
  queryKeys,
  UnpackedHypermediaId,
  useUniversalAppContext,
} from "@shm/shared";
import {Button} from "@shm/ui/button";
import {Field} from "@shm/ui/form-fields";
import {FormInput} from "@shm/ui/form-input";
import {HMIcon} from "@shm/ui/hm-icon";
import {
  DialogDescription,
  DialogTitle,
  useAppDialog,
} from "@shm/ui/universal-dialog";
import {useMutation, useQueryClient} from "@tanstack/react-query";
import {BlockView} from "multiformats";
import {base58btc} from "multiformats/bases/base58";
import * as Block from "multiformats/block";
import {CID} from "multiformats/cid";
import * as rawCodec from "multiformats/codecs/raw";
import {sha256} from "multiformats/hashes/sha2";
import {useEffect, useSyncExternalStore} from "react";
import {
  Control,
  FieldValues,
  Path,
  SubmitHandler,
  useController,
  useForm,
} from "react-hook-form";
import {Form, SizableText, Stack, XStack, YStack} from "tamagui";
import {z} from "zod";
import {useEntity} from "./models";
import type {CreateAccountPayload} from "./routes/hm.api.create-account";

async function postCBOR(path: string, body: Uint8Array) {
  const response = await fetch(`${path}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/cbor",
    },
  });
  return await response.json();
}

const DB_NAME = "keyStore-04";
const STORE_NAME = "keys-01";
const DB_VERSION = 1;

async function openKeyDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function getStoredKeyPair(): Promise<CryptoKeyPair | null> {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const privateRequest = store.get("privateKey");
    const publicRequest = store.get("publicKey");

    let privateKey: CryptoKey | null = null;
    let publicKey: CryptoKey | null = null;

    privateRequest.onerror = () => reject(privateRequest.error);
    publicRequest.onerror = () => reject(publicRequest.error);

    privateRequest.onsuccess = () => {
      privateKey = privateRequest.result;
      if (publicKey !== null) {
        resolve(privateKey && publicKey ? {privateKey, publicKey} : null);
      }
    };

    publicRequest.onsuccess = () => {
      publicKey = publicRequest.result;
      if (privateKey !== null) {
        resolve(privateKey && publicKey ? {privateKey, publicKey} : null);
      }
    };
  });
}

async function storeKeyPair(keyPair: CryptoKeyPair): Promise<void> {
  const db = await openKeyDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const privateRequest = store.put(keyPair.privateKey, "privateKey");
    const publicRequest = store.put(keyPair.publicKey, "publicKey");

    let privateComplete = false;
    let publicComplete = false;

    privateRequest.onerror = () => reject(privateRequest.error);
    publicRequest.onerror = () => reject(publicRequest.error);

    privateRequest.onsuccess = () => {
      privateComplete = true;
      if (publicComplete) resolve();
    };

    publicRequest.onsuccess = () => {
      publicComplete = true;
      if (privateComplete) resolve();
    };
  });
}

async function deleteKeyPair() {
  const db = await openKeyDB();
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  store.clear();
}

async function getKeyPair() {
  const existingKeyPair = await getStoredKeyPair();

  return existingKeyPair;
}

const cborCodec = {
  code: 0x71,
  encode: (input: any) => cborEncode(input),
  name: "DAG-CBOR",
};

async function encodeBlock(
  data: any,
  codec?: Parameters<typeof Block.encode>[0]["codec"]
): Promise<BlockView<unknown, number, 18, 1>> {
  const block = await Block.encode({
    value: data,
    codec: codec || cborCodec,
    // codec: raw,
    hasher: sha256,
  });
  console.log("ENCODED BLOCK", block.cid);
  return block;
  // const cid = block.cid;
  // const data = block.value
  // return cid;
}

async function createAccount({name, icon}: {name: string; icon: Blob | null}) {
  const existingKeyPair = await getStoredKeyPair();
  if (existingKeyPair) {
    throw new Error("Account already exists");
  }
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false, // non-extractable
    ["sign", "verify"]
  );
  const genesisChange = await createDocumentGenesisChange({
    keyPair,
  });
  const genesisChangeBlock = await encodeBlock(genesisChange);
  const iconBlock = icon
    ? await encodeBlock(await icon.arrayBuffer(), rawCodec)
    : null;
  const operations: HMDocumentOperation[] = [
    {
      type: "SetAttributes",
      attrs: [{key: ["name"], value: name}],
    },
  ];
  if (iconBlock) {
    operations.push({
      type: "SetAttributes",
      attrs: [{key: ["icon"], value: iconBlock.cid.toString()}],
    });
  }
  const changeHome = await createHomeDocumentChange({
    keyPair,
    genesisChangeCid: genesisChangeBlock.cid,
    operations,
    deps: [genesisChangeBlock.cid],
    depth: 1,
  });
  const changeHomeBlock = await encodeBlock(changeHome);
  const ref = await createRef({
    keyPair,
    genesisCid: genesisChangeBlock.cid,
    head: changeHomeBlock.cid,
    generation: 1,
  });
  const refBlock = await encodeBlock(ref);
  const createAccountPayload: CreateAccountPayload = {
    genesis: {
      data: genesisChangeBlock.bytes,
      cid: genesisChangeBlock.cid.toString(),
    },
    home: {
      data: changeHomeBlock.bytes,
      cid: changeHomeBlock.cid.toString(),
    },
    ref: refBlock.bytes,
    icon: iconBlock
      ? {
          data: iconBlock.bytes,
          cid: iconBlock.cid.toString(),
        }
      : null,
  };
  const createAccountData = cborEncode(createAccountPayload);
  await postCBOR("/hm/api/create-account", createAccountData);
  await storeKeyPair(keyPair);
  setKeyPair({
    ...keyPair,
    id: base58btc.encode(await preparePublicKey(keyPair.publicKey)),
  });
  return keyPair;
}

async function updateProfile(
  keyPair: CryptoKeyPair,
  newValues: SiteMetaFields,
  genesisChangeCid: CID,
  deps: CID[]
) {
  const updatePayload = await createHomeDocumentChange({
    keyPair,
    genesisChangeCid,
    operations: [{type: "SetAttributes", attrs: newValues}],
    deps,
  });
  const updateBlock = await encodeBlock(updatePayload);
  await postCBOR("/hm/api/update-account", updateBlock.bytes);
}

async function signObject(
  keyPair: CryptoKeyPair,
  data: any
): Promise<ArrayBuffer> {
  const cborData = cborEncode(data);
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: {name: "SHA-256"},
    },
    keyPair.privateKey,
    cborData
  );
  return signature;
}

function annotationsToPublishable(
  annotations: HMAnnotation[]
): HMPublishableAnnotation[] {
  return annotations.map((annotation) => {
    const {type, starts, ends} = annotation;
    if (type === "Bold") return {type: "Bold", starts, ends};
    if (type === "Italic") return {type: "Italic", starts, ends};
    if (type === "Underline") return {type: "Underline", starts, ends};
    if (type === "Strike") return {type: "Strike", starts, ends};
    if (type === "Code") return {type: "Code", starts, ends};
    if (type === "Link")
      return {type: "Link", starts, ends, link: annotation.link || ""};
    if (type === "Embed")
      return {type: "Embed", starts, ends, link: annotation.link || ""};
    throw new Error(`Unsupported annotation type: ${type}`);
  });
}

function blockToPublishable(blockNode: HMBlockNode): HMPublishableBlock | null {
  const block = blockNode.block;
  if (block.type === "Paragraph") {
    if (block.text === "") return null;
    if (block.text === undefined) return null;
    return {
      id: block.id,
      type: "Paragraph",
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    };
  } else if (block.type === "Heading") {
    return {
      id: block.id,
      type: "Heading",
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    };
  } else if (block.type === "Math") {
    return {
      id: block.id,
      type: "Math",
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    };
  } else if (block.type === "Code") {
    return {
      id: block.id,
      type: "Code",
      text: block.text,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    };
  } else if (block.type === "Image") {
    return {
      id: block.id,
      type: "Image",
      text: block.text,
      link: block.link,
      annotations: annotationsToPublishable(block.annotations || []),
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    };
  } else if (block.type === "Video") {
    return {
      id: block.id,
      type: "Video",
      text: "",
      link: block.link,
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    };
  } else if (block.type === "File") {
    return {
      id: block.id,
      type: "File",
      link: block.link,
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    };
  } else if (block.type === "Button") {
    return {
      id: block.id,
      type: "Button",
      text: block.text,
      link: block.link,
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    };
  } else if (block.type === "Embed") {
    return {
      id: block.id,
      type: "Embed",
      link: block.link,
      ...block.attributes,
      children: hmBlocksToPublishable(blockNode.children || []),
    };
  }
  throw new Error(`Unsupported block type: ${block.type}`);
}

function hmBlocksToPublishable(
  blockNodes: HMBlockNode[]
): HMPublishableBlock[] {
  return blockNodes
    .map((blockNode) => {
      const block = blockToPublishable(blockNode);
      if (!block) return null;
      return block;
    })
    .filter((blockNode) => blockNode !== null);
}

type UnsignedComment = {
  type: "Comment";
  body: HMPublishableBlock[];
  space: Uint8Array;
  path: string;
  version: CID[];
  replyParent?: CID;
  threadRoot?: CID;
  signer: Uint8Array;
  ts: bigint;
  sig: Uint8Array; // new Uint8Array(64); // we are expected to sign a blob with empty signature
};
type SignedComment = Omit<UnsignedComment, "sig"> & {
  sig: ArrayBuffer;
};

type UnsignedDocumentChange = {
  type: "Change";
  body?: {
    ops: HMDocumentOperation[];
    opCount: number;
  };
  signer: Uint8Array;
  sig: Uint8Array; // new Uint8Array(64); // we are expected to sign a blob with empty signature
  ts?: bigint; // undefined for genesis only!
  depth?: number;
  genesis?: CID;
  deps?: CID[];
};
type SignedDocumentChange = Omit<UnsignedDocumentChange, "sig"> & {
  sig: ArrayBuffer;
};

type UnsignedRef = {
  type: "Ref";
  space?: Uint8Array;
  path?: string;
  genesisBlob: CID;
  capability?: Uint8Array;
  heads: CID[];
  generation: number;
  signer: Uint8Array;
  ts: bigint;
  sig: Uint8Array; // new Uint8Array(64); // we are expected to sign a blob with empty signature
};
type SignedRef = Omit<UnsignedRef, "sig"> & {
  sig: ArrayBuffer;
};

async function createComment({
  content,
  docId,
  docVersion,
  keyPair,
  replyCommentId,
  rootReplyCommentId,
}: {
  content: HMBlockNode[];
  docId: UnpackedHypermediaId;
  docVersion: string;
  keyPair: CryptoKeyPair;
  replyCommentId?: string;
  rootReplyCommentId?: string;
}) {
  const signerKey = await preparePublicKey(keyPair.publicKey);
  const unsignedComment: UnsignedComment = {
    type: "Comment",
    body: hmBlocksToPublishable(content),
    space: base58btc.decode(docId.uid),
    path: hmIdPathToEntityQueryPath(docId.path),
    version: docVersion.split(".").map((changeId) => CID.parse(changeId)),
    // capability: cid of the capability that is being exercised
    // author: prepared account id of the comment author, if it is different from the signer
    signer: signerKey,
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
  };
  if (replyCommentId) {
    unsignedComment.replyParent = CID.parse(replyCommentId);
    if (rootReplyCommentId) {
      unsignedComment.threadRoot = CID.parse(rootReplyCommentId);
    }
  }
  const signature = await signObject(keyPair, unsignedComment);
  return {
    ...unsignedComment,
    sig: signature,
  } satisfies SignedComment;
}

async function createDocumentGenesisChange({
  keyPair,
}: {
  keyPair: CryptoKeyPair;
}) {
  const signerKey = await preparePublicKey(keyPair.publicKey);
  const unsignedChange: UnsignedDocumentChange = {
    type: "Change",
    signer: signerKey,
    sig: new Uint8Array(64),
    ts: 0n,
  };
  const signature = await signObject(keyPair, unsignedChange);
  return {
    ...unsignedChange,
    sig: signature,
  } satisfies SignedDocumentChange;
}

async function createHomeDocumentChange({
  operations,
  keyPair,
  genesisChangeCid,
  deps,
  depth,
}: {
  operations: HMDocumentOperation[];
  keyPair: CryptoKeyPair;
  genesisChangeCid: CID;
  deps: CID[];
  depth: number;
}) {
  const signerKey = await preparePublicKey(keyPair.publicKey);
  const unsignedChange: UnsignedDocumentChange = {
    type: "Change",
    body: {
      ops: operations,
      opCount: operations.length,
    },
    signer: signerKey,
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
    genesis: genesisChangeCid,
    deps,
    depth,
  };
  const signature = await signObject(keyPair, unsignedChange);
  return {
    ...unsignedChange,
    sig: signature,
  } satisfies SignedDocumentChange;
}

async function createRef({
  keyPair,
  genesisCid,
  head,
  space,
  path,
  generation,
}: {
  keyPair: CryptoKeyPair;
  genesisCid: CID;
  head: CID;
  space?: Uint8Array;
  path?: string;
  generation: number;
}) {
  const signerKey = await preparePublicKey(keyPair.publicKey);
  const unsignedRef: UnsignedRef = {
    type: "Ref",
    signer: signerKey,
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
    genesisBlob: genesisCid,
    heads: [head],
    generation,
  };
  if (path) {
    unsignedRef.path = path;
  }
  if (space) {
    unsignedRef.space = space;
  }
  const signature = await signObject(keyPair, unsignedRef);
  return {
    ...unsignedRef,
    sig: signature,
  } satisfies SignedRef;
}

async function preparePublicKey(publicKey: CryptoKey) {
  // Export raw key first
  const raw = await crypto.subtle.exportKey("raw", publicKey);
  const bytes = new Uint8Array(raw);

  // Raw format is 65 bytes: 0x04 + x (32) + y (32)
  const x = bytes.slice(1, 33);
  const y = bytes.slice(33);

  // Check if y is odd
  const prefix = y[31] & 1 ? 0x03 : 0x02;

  const outputKeyValue = new Uint8Array([
    // varint prefix for 0x1200
    128,
    36,
    prefix,
    ...x,
  ]);
  return outputKeyValue;
}

if (typeof window !== "undefined") {
  getKeyPair()
    .then(async (kp) => {
      if (!kp) return null;
      const id = await preparePublicKey(kp.publicKey);
      return {
        ...kp,
        id: base58btc.encode(id),
      } satisfies WebIdentity;
    })
    .then((kp) => {
      console.log("Set up user key pair", kp);
      if (kp) setKeyPair(kp);
    })
    .catch((err) => {
      console.error("Error getting key pair", err);
    });
}

type WebIdentity = CryptoKeyPair & {
  id: string;
};
let keyPair: WebIdentity | null = null;
const keyPairHandlers = new Set<() => void>();

function setKeyPair(kp: WebIdentity | null) {
  keyPair = kp;
  keyPairHandlers.forEach((callback) => callback());
}

function logout() {
  deleteKeyPair()
    .then(() => {
      setKeyPair(null);
      console.log("Logged out");
    })
    .catch((e) => {
      console.error("Failed to log out", e);
    });
}

const keyPairStore = {
  get: () => keyPair,
  listen: (callback: () => void) => {
    keyPairHandlers.add(callback);
    return () => {
      keyPairHandlers.delete(callback);
    };
  },
};

function useKeyPair() {
  const keyPair = useSyncExternalStore(
    keyPairStore.listen,
    keyPairStore.get,
    () => null
  );
  return keyPair;
}

type CreateCommentPayload = {
  content: HMBlockNode[];
  docId: UnpackedHypermediaId;
  docVersion: string;
  userKeyPair: CryptoKeyPair;
  replyCommentId?: string;
  rootReplyCommentId?: string;
};

export type WebCommentingProps = {
  docId: UnpackedHypermediaId;
  replyCommentId: string | null;
  rootReplyCommentId: string | null;
  onDiscardDraft?: () => void;
};

export default function WebCommenting({
  docId,
  replyCommentId,
  rootReplyCommentId,
  onDiscardDraft,
}: WebCommentingProps) {
  const userKeyPair = useKeyPair();
  const queryClient = useQueryClient();
  const postComment = useMutation({
    mutationFn: async ({
      content,
      docId,
      docVersion,
      userKeyPair,
      replyCommentId,
      rootReplyCommentId,
    }: CreateCommentPayload) => {
      const comment = await createComment({
        content,
        docId,
        docVersion,
        keyPair: userKeyPair,
        replyCommentId,
        rootReplyCommentId,
      });
      const result = await postCBOR("/hm/api/comment", cborEncode(comment));
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_ACTIVITY, docId.id],
      });
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_COMMENTS, docId.id],
      });
    },
  });

  const docVersion = docId.version;
  const createAccountDialog = useAppDialog(CreateAccountDialog);
  const myAccountId = userKeyPair ? hmId("d", userKeyPair.id) : null;
  const myAccount = useEntity(myAccountId || undefined);
  const myName = myAccount.data?.document?.metadata?.name;
  const commentActionMessage = myName
    ? `Comment as ${myName}`
    : "Submit Comment";
  if (!docVersion) return null;
  return (
    <>
      <CommentEditor
        submitButton={({getContent, reset}) => {
          return (
            <Button
              size="$2"
              theme="blue"
              icon={
                myAccountId ? (
                  <HMIcon
                    id={myAccountId}
                    metadata={myAccount.data?.document?.metadata}
                    size={24}
                  />
                ) : undefined
              }
              onPress={() => {
                const content = getContent();
                if (!userKeyPair) {
                  createAccountDialog.open({});
                  return;
                }
                const mutatePayload: CreateCommentPayload = {
                  content,
                  docId,
                  docVersion,
                  userKeyPair,
                };
                if (replyCommentId && rootReplyCommentId) {
                  mutatePayload.replyCommentId = replyCommentId;
                  mutatePayload.rootReplyCommentId = rootReplyCommentId;
                }
                postComment.mutateAsync(mutatePayload).then(() => {
                  reset();
                  onDiscardDraft?.();
                });
              }}
            >
              {userKeyPair ? commentActionMessage : "Create Account"}
            </Button>
          );
        }}
        onDiscardDraft={onDiscardDraft}
      />
      {createAccountDialog.content}
    </>
  );
}
const siteMetaSchema = z.object({
  name: z.string(),
  icon: z.instanceof(Blob).nullable(),
});
type SiteMetaFields = z.infer<typeof siteMetaSchema>;
function CreateAccountDialog({
  input,
  onClose,
}: {
  input: {};
  onClose: () => void;
}) {
  const {origin} = useUniversalAppContext();
  const onSubmit: SubmitHandler<SiteMetaFields> = (data) => {
    createAccount({name: data.name, icon: data.icon}).then(() => onClose());
  };
  const siteName = hostnameStripProtocol(origin);
  return (
    <>
      <DialogTitle>Create Account on {siteName}</DialogTitle>
      <DialogDescription>
        Your account key will be securely stored in this browser. The identity
        will be accessible only on this domain, but you can link it to other
        domains and devices.
      </DialogDescription>
      <EditProfileForm
        onSubmit={onSubmit}
        submitLabel={`Create ${siteName} Account`}
      />
    </>
  );
}

function EditProfileForm({
  onSubmit,
  defaultValues,
  submitLabel,
}: {
  onSubmit: (data: SiteMetaFields) => void;
  defaultValues?: SiteMetaFields;
  submitLabel?: string;
}) {
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<SiteMetaFields>({
    resolver: zodResolver(siteMetaSchema),
    defaultValues: defaultValues || {
      name: "",
      icon: null,
    },
  });
  useEffect(() => {
    setTimeout(() => {
      setFocus("name");
    }, 300); // wait for animation
  }, [setFocus]);
  return (
    <Form onSubmit={handleSubmit(onSubmit)}>
      <YStack gap="$2">
        <Field id="name" label="Account Name">
          <FormInput control={control} name="name" placeholder="Account Name" />
        </Field>
        <ImageField control={control} name="icon" label="Site Icon" />
        <XStack jc="center">
          <Form.Trigger asChild>
            <Button>{submitLabel || "Save Account"}</Button>
          </Form.Trigger>
        </XStack>
      </YStack>
    </Form>
  );
}

async function optimizeImage(file: File): Promise<Blob> {
  const response = await fetch("/hm/api/site-image", {
    method: "POST",
    body: await file.arrayBuffer(),
  });
  const signature = response.headers.get("signature");
  if (!signature) {
    throw new Error("No signature found");
  }
  if (signature !== "SIG-TODO") {
    // todo: real signature checking.. not here but at re-upload time
    throw new Error("Invalid signature");
  }
  const contentType = response.headers.get("content-type") || "image/png";
  const responseBlob = await response.blob();
  return new Blob([responseBlob], {type: contentType});
}

function ImageField<Fields extends FieldValues>({
  control,
  name,
  label,
}: {
  control: Control<Fields>;
  name: Path<Fields>;
  label: string;
}) {
  const c = useController({control, name});

  return (
    <Stack
      position="relative"
      group="icon"
      overflow="hidden"
      height={128}
      width={128}
      borderRadius="$2"
      alignSelf="stretch"
      flex={1}
    >
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          optimizeImage(file).then((blob) => {
            c.field.onChange(blob);
          });
        }}
        style={{
          opacity: 0,
          display: "flex",
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
        }}
      />
      {!c.field.value && (
        <XStack
          bg="rgba(0,0,0,0.3)"
          position="absolute"
          gap="$2"
          zi="$zIndex.5"
          w="100%"
          $group-icon-hover={{opacity: 0.5}}
          h="100%"
          opacity={1}
          ai="center"
          jc="center"
          pointerEvents="none"
        >
          <SizableText textAlign="center" size="$1" color="white">
            Add {label}
          </SizableText>
        </XStack>
      )}
      {c.field.value && (
        <img
          src={URL.createObjectURL(c.field.value)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            position: "absolute",
            left: 0,
            top: 0,
          }}
        />
      )}
      {c.field.value && (
        <XStack
          bg="rgba(0,0,0,0.3)"
          position="absolute"
          gap="$2"
          zi="$zIndex.5"
          w="100%"
          $group-icon-hover={{opacity: 1}}
          h="100%"
          opacity={0}
          ai="center"
          jc="center"
          pointerEvents="none"
        >
          <SizableText textAlign="center" size="$1" color="white">
            Edit {label}
          </SizableText>
        </XStack>
      )}
    </Stack>
  );
}

function LogoutDialog({onClose}: {onClose: () => void}) {
  return (
    <>
      <DialogTitle>Really Logout?</DialogTitle>
      <DialogDescription>
        This account key is not saved anywhere else. By logging out, you will
        loose access to this identity forever.
      </DialogDescription>
      <Button
        onPress={() => {
          logout();
          onClose();
        }}
        theme="red"
      >
        Log out Forever
      </Button>
    </>
  );
}

function EditProfileDialog({
  onClose,
  input,
}: {
  onClose: () => void;
  input: {accountUid: string};
}) {
  const account = useEntity(hmId("d", input.accountUid));
  return (
    <>
      <DialogTitle>Edit Profile</DialogTitle>
      <EditProfileForm
        defaultValues={{name: account.data?.document?.metadata?.name || "?"}}
        onSubmit={(newValues) => {
          const deps = account.data?.document?.version
            .split(".")
            .map((cidStr) => CID.parse(cidStr));
          const genesisStr = account.data?.document?.genesis;
          // const uhShitDepth = account.data?.document?.depth;
          const genesis = genesisStr ? CID.parse(genesisStr) : null;
          if (!keyPair) {
            throw new Error("No key pair found");
          }
          if (!deps) {
            throw new Error("No deps found");
          }
          if (!genesis) {
            throw new Error("No genesis found");
          }
          console.log("DO EDIT!", newValues, genesis, deps);
          updateProfile(keyPair, newValues, genesis, deps).then(() =>
            onClose()
          );
        }}
      />
    </>
  );
}

export function AccountFooterActions() {
  const userKeyPair = useKeyPair();
  const logoutDialog = useAppDialog(LogoutDialog);
  const editProfileDialog = useAppDialog(EditProfileDialog);
  if (!userKeyPair) return null;
  return (
    <XStack gap="$2">
      <Button
        size="$2"
        onPress={() => logoutDialog.open({})}
        backgroundColor="$color4"
      >
        Logout
      </Button>
      <Button
        size="$2"
        onPress={() => editProfileDialog.open({accountUid: userKeyPair.id})}
        backgroundColor="$color4"
      >
        Edit Profile
      </Button>
      {logoutDialog.content}
      {editProfileDialog.content}
    </XStack>
  );
}
