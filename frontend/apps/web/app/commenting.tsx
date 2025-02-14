import {encode as cborEncode} from "@ipld/dag-cbor";
import {base58} from "@scure/base";
import CommentEditor from "@shm/editor/comment-editor";
import {
  HMBlockNode,
  HMTimestamp,
  SITE_BASE_URL,
  UnpackedHypermediaId,
} from "@shm/shared";
import {YStack} from "@tamagui/stacks";
import {varint} from "multiformats";
import {useEffect, useSyncExternalStore} from "react";

function bufferToB58(buf: ArrayBuffer) {
  return base58.encode(new Uint8Array(buf));
}

async function postAPI(path: string, body: any) {
  const response = await fetch(`${SITE_BASE_URL}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
  return await response.json();
}

async function getAPI(path: string) {
  const response = await fetch(`${SITE_BASE_URL}${path}`, {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error("Failed to fetch");
  }
  return await response.json();
}

function generateTimetamp(): HMTimestamp {
  const now = new Date();
  return {
    seconds: BigInt(Math.floor(now.getTime() / 1000)),
    nanos: (now.getTime() % 1000) * 1000000,
  };
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

async function createComment(content: HMBlockNode[], keyPair: CryptoKeyPair) {
  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const unsignedComment = {
    content,
    author: varint.encodeTo(0x1200, new Uint8Array(publicKeyRaw)),
    createTime: generateTimetamp(),
  };
  const signature = await signObject(keyPair, unsignedComment);
  return {
    ...unsignedComment,
    signature,
  };
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

export default function WebCommenting({docId}: {docId: UnpackedHypermediaId}) {
  const userKeyPair = useSyncExternalStore(
    keyPairStore.listen,
    keyPairStore.get,
    () => null
  );
  useEffect(() => {
    // setReady(true);
  }, []);

  if (!userKeyPair) return null;
  return (
    <YStack borderRadius="$4" minHeight={105} bg="$color4">
      {true ? (
        <CommentEditor
          onCommentSubmit={(content) => {
            createComment(content, userKeyPair).then((comment) => {
              console.log("NEW COMMENT", comment);
            });
          }}
        />
      ) : null}
    </YStack>
  );
}
