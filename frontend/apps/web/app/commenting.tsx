import {encode as cborEncode} from "@ipld/dag-cbor";
import CommentEditor from "@shm/editor/comment-editor";
import {
  HMAnnotation,
  HMBlockNode,
  hmIdPathToEntityQueryPath,
  HMPublishableAnnotation,
  HMPublishableBlock,
  SITE_BASE_URL,
  UnpackedHypermediaId,
} from "@shm/shared";
import {YStack} from "@tamagui/stacks";
import {useMutation} from "@tanstack/react-query";
import {CID, varint} from "multiformats";
import {base58btc} from "multiformats/bases/base58";
import {useEffect, useSyncExternalStore} from "react";

async function postCBOR(path: string, body: Uint8Array) {
  const response = await fetch(`${SITE_BASE_URL}${path}`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/cbor",
    },
  });
  return await response.json();
}

const DB_NAME = "keyStore-01";
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

async function getKeyPair() {
  const existingKeyPair = await getStoredKeyPair();
  let keyPair: CryptoKeyPair;

  if (existingKeyPair) {
    keyPair = existingKeyPair;
  } else {
    keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      false, // non-extractable
      ["sign", "verify"]
    );
    await storeKeyPair(keyPair);
  }
  return keyPair;
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

async function createComment(
  content: HMBlockNode[],
  docId: UnpackedHypermediaId,
  docVersion: string,
  keyPair: CryptoKeyPair
) {
  const signerKey = await preparePublicKey(keyPair.publicKey);
  const unsignedComment = {
    type: "Comment",
    body: hmBlocksToPublishable(content),
    space: base58btc.decode(docId.uid),
    path: hmIdPathToEntityQueryPath(docId.path),
    version: docVersion.split(".").map((changeId) => CID.parse(changeId)),
    // threadRoot: cid of the root comment
    // replyParent: cid of the parent comment this is in reply to, if this is a reply
    // capability: cid of the capability that is being exercised
    // author: prepared account id of the comment author, if it is different from the signer
    signer: signerKey,
    ts: BigInt(Date.now()),
  };
  const signature = await signObject(keyPair, unsignedComment);
  return {
    ...unsignedComment,
    sig: signature,
  };
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

  // Combine prefix and x
  const outputKey = new Uint8Array([prefix, ...x]);
  varint.encodeTo(0x1200, outputKey);
  return outputKey;
}

let keyPair: CryptoKeyPair | null = null;
const keyPairHandlers = new Set<() => void>();

function setKeyPair(kp: CryptoKeyPair | null) {
  keyPair = kp;
  keyPairHandlers.forEach((callback) => callback());
}

// run this on the client
if (typeof window !== "undefined") {
  getKeyPair()
    .then((kp) => {
      console.log("Set up user key pair", kp);
      setKeyPair(kp);
    })
    .catch((err) => {
      console.error("Error getting key pair", err);
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

export default function WebCommenting({
  docId,
  docVersion,
}: {
  docId: UnpackedHypermediaId;
  docVersion: string;
}) {
  const userKeyPair = useSyncExternalStore(
    keyPairStore.listen,
    keyPairStore.get,
    () => null
  );
  useEffect(() => {
    // setReady(true);
  }, []);

  const postComment = useMutation({
    mutationFn: async ({
      content,
      docId,
      docVersion,
      userKeyPair,
    }: {
      content: HMBlockNode[];
      docId: UnpackedHypermediaId;
      docVersion: string;
      userKeyPair: CryptoKeyPair;
    }) => {
      const comment = await createComment(
        content,
        docId,
        docVersion,
        userKeyPair
      );
      console.log("SENDING COMMENT", comment);
      const result = await postCBOR("/hm/api/comment", cborEncode(comment));
      console.log("COMMENT SENT", result);
    },
  });

  if (!userKeyPair) return null;
  return (
    <YStack borderRadius="$4" minHeight={105} bg="$color4">
      {true ? (
        <CommentEditor
          onCommentSubmit={(content) => {
            postComment.mutate({content, docId, docVersion, userKeyPair});
          }}
        />
      ) : null}
    </YStack>
  );
}
