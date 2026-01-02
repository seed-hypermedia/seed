import { decode as cborDecode, encode as cborEncode } from "@ipld/dag-cbor";
import {
  HMAnnotation,
  HMBlockNode,
  HMDocumentOperation,
  hmIdPathToEntityQueryPath,
  HMPublishableAnnotation,
  HMPublishableBlock,
  UnpackedHypermediaId,
} from "@shm/shared";
import { getDaemonFileUrl } from "@shm/ui/get-file-url";
import { BlockView, CID } from "multiformats";
import { base58btc } from "multiformats/bases/base58";
import * as Block from "multiformats/block";
import { sha256 } from "multiformats/hashes/sha2";
import { z } from "zod";
import { preparePublicKey } from "./auth-utils";

export { decode as cborDecode, encode as cborEncode } from "@ipld/dag-cbor";

export * as rawCodec from "multiformats/codecs/raw";

export async function postCBOR(path: string, body: Uint8Array) {
  const response = await fetch(`${path}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/cbor",
    },
  });
  return await response.json();
}

export async function get(path: string) {
  const response = await fetch(`${path}`, {});
  return await response.json();
}

export async function post(path: string, body: any) {
  const response = await fetch(`${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return await response.json();
}

export const cborCodec = {
  code: 0x71,
  encode: (input: any) => cborEncode(input),
  name: "DAG-CBOR",
};

type EncodedBlock = BlockView<unknown, number, 18, 1>;

export async function encodeBlock(
  data: any,
  codec?: Parameters<typeof Block.encode>[0]["codec"]
): Promise<EncodedBlock> {
  const block = await Block.encode({
    value: data,
    codec: codec || cborCodec,
    hasher: sha256,
  });
  return block;
}

export function blockReference(block: EncodedBlock) {
  return {
    data: block.bytes,
    cid: block.cid.toString(),
  } as const;
}

export async function getChangesDepth(deps: string[]) {
  const allDepths = await Promise.all(
    deps.map(async (dep) => {
      const res = await fetch(getDaemonFileUrl(dep));
      const data = await res.arrayBuffer();
      const cborData = new Uint8Array(data);
      const decoded = cborDecode(cborData) as { depth: number };
      return decoded.depth;
    })
  );
  return Math.max(...allDepths);
}

export async function signObject(
  keyPair: CryptoKeyPair,
  data: any
): Promise<ArrayBuffer> {
  const cborData = cborEncode(data);
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: { name: "SHA-256" },
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
    const { type, starts, ends } = annotation;
    if (type === "Bold") return { type: "Bold", starts, ends };
    if (type === "Italic") return { type: "Italic", starts, ends };
    if (type === "Underline") return { type: "Underline", starts, ends };
    if (type === "Strike") return { type: "Strike", starts, ends };
    if (type === "Code") return { type: "Code", starts, ends };
    if (type === "Link")
      return { type: "Link", starts, ends, link: annotation.link || "" };
    if (type === "Embed")
      return { type: "Embed", starts, ends, link: annotation.link || "" };
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
  } else if (block.type === "WebEmbed") {
    return {
      id: block.id,
      type: "WebEmbed",
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

export const unsignedCommentSchema = z.object({
  type: z.literal("Comment"),
  body: z.array(z.any()), // todo, use a zod schema for HMPublishableBlock
  space: z.instanceof(Uint8Array),
  path: z.string(),
  version: z.string(),
  replyParent: z.string().optional(),
  threadRoot: z.string().optional(),
  signer: z.instanceof(Uint8Array),
  ts: z.bigint(),
  sig: z.instanceof(Uint8Array), // new Uint8Array(64); // we are expected to sign a blob with empty signature
});

export type UnsignedComment = z.infer<typeof unsignedCommentSchema>;

export type SignedComment = {
  type: "Comment";
  body: HMPublishableBlock[];
  space: Uint8Array;
  path: string;
  version: CID[];
  replyParent?: CID;
  threadRoot?: CID;
  signer: Uint8Array;
  ts: bigint;
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

export function createUnsignedComment({
  content,
  docId,
  docVersion,
  signerKey,
  replyCommentVersion,
  rootReplyCommentVersion,
}: {
  content: HMBlockNode[];
  docId: UnpackedHypermediaId;
  docVersion: string;
  signerKey: Uint8Array;
  replyCommentVersion?: string | null;
  rootReplyCommentVersion?: string | null;
}): UnsignedComment {
  // this must be serializable because it will be passed between iframe for delegated signing
  const unsignedComment: UnsignedComment = {
    type: "Comment",
    body: hmBlocksToPublishable(content),
    space: base58btc.decode(docId.uid),
    version: docVersion,
    signer: signerKey,
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
    path: hmIdPathToEntityQueryPath(docId.path),
    replyParent: replyCommentVersion || undefined,
    threadRoot: rootReplyCommentVersion || undefined,
  };
  // ipld fails to encode undefined, so they must be removed, lol
  if (!unsignedComment.replyParent) delete unsignedComment.replyParent;
  if (!unsignedComment.threadRoot) delete unsignedComment.threadRoot;
  return unsignedComment;
}

export function createSignedComment(
  comment: UnsignedComment,
  signature: ArrayBuffer
): SignedComment {
  const signedComment = {
    ...comment,
    version: comment.version.split(".").map((v) => CID.parse(v)),
    replyParent: comment.replyParent
      ? CID.parse(comment.replyParent)
      : undefined,
    threadRoot: comment.threadRoot ? CID.parse(comment.threadRoot) : undefined,
    sig: signature,
  } satisfies SignedComment;
  // ipld fails to encode undefined, so they must be removed, lol
  if (!signedComment.replyParent) delete signedComment.replyParent;
  if (!signedComment.threadRoot) delete signedComment.threadRoot;
  return signedComment;
}

export async function signComment(
  comment: UnsignedComment,
  keyPair: CryptoKeyPair
): Promise<SignedComment> {
  const commentForSigning = {
    ...comment,
    version: comment.version.split(".").map((v) => CID.parse(v)),
  } as SignedComment;
  if (comment.threadRoot) {
    commentForSigning.threadRoot = CID.parse(comment.threadRoot);
  }
  if (comment.replyParent) {
    commentForSigning.replyParent = CID.parse(comment.replyParent);
  }
  commentForSigning.sig = await signObject(keyPair, commentForSigning);
  return commentForSigning;
}

export async function createComment({
  content,
  docId,
  docVersion,
  keyPair,
  replyCommentVersion,
  rootReplyCommentVersion,
}: {
  content: HMBlockNode[];
  docId: UnpackedHypermediaId;
  docVersion: string;
  keyPair: CryptoKeyPair;
  replyCommentVersion?: string | null;
  rootReplyCommentVersion?: string | null;
}) {
  const signerKey = await preparePublicKey(keyPair.publicKey);
  cleanContentOfUndefined(content);
  const unsignedComment = createUnsignedComment({
    content,
    docId,
    docVersion,
    signerKey,
    replyCommentVersion,
    rootReplyCommentVersion,
  });
  const signedComment = await signComment(unsignedComment, keyPair);
  return signedComment;
}

function cleanContentOfUndefined(content: HMBlockNode[]) {
  content.forEach((blockNode) => {
    const { block, children } = blockNode;
    // @ts-expect-error
    if (typeof block.text === "undefined") block.text = "";
    if (children) cleanContentOfUndefined(children);
  });
}

export async function createDocumentGenesisChange({
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

export async function createHomeDocumentChange({
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

export async function createRef({
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
  if (space && !uint8Equals(space, signerKey)) {
    unsignedRef.space = space;
  }
  const signature = await signObject(keyPair, unsignedRef);
  return {
    ...unsignedRef,
    sig: signature,
  } satisfies SignedRef;
}

function uint8Equals(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
