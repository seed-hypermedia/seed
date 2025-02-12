import {encode as cborEncode} from "@ipld/dag-cbor";
import {base58} from "@scure/base";
import CommentEditor from "@shm/editor/comment-editor";
import {HMTimestamp, SITE_BASE_URL, UnpackedHypermediaId} from "@shm/shared";
import {useAppDialog} from "@shm/ui/src/universal-dialog";
import {Button} from "@tamagui/button";
import {YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {useEffect, useRef, useState, useSyncExternalStore} from "react";
import {z} from "zod";
import type {HMUnsignedComment} from "./routes/hm.api.comment";

const userIdentitySchema = z.object({
  username: z.string(),
  publicKey: z.string(),
  credId: z.string(),
});
const userIdentityHandlers = new Set<() => void>();
let userIdState: z.infer<typeof userIdentitySchema> | null = null;
try {
  const identity = localStorage.getItem("userIdentity");
  if (identity && identity !== "null") {
    userIdState = userIdentitySchema.parse(JSON.parse(identity));
  }
} catch (error) {
  console.error(error);
}
// const REQUESTING_PARTY_HOST = SITE_BASE_URL?.replace(/^https?:\/\//, "") // strip protocol
//   .replace(/\/$/, "");
const REQUESTING_PARTY_HOST = "localhost"; // for local development
const userIdentity = {
  get: () => userIdState,
  listen: (callback: () => void) => {
    userIdentityHandlers.add(callback);
    return () => {
      userIdentityHandlers.delete(callback);
    };
  },
};
function setUserIdentity(identity: z.infer<typeof userIdentitySchema> | null) {
  localStorage.setItem("userIdentity", JSON.stringify(identity));
  userIdState = identity;
  userIdentityHandlers.forEach((callback) => callback());
}

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

function AuthDialogContent({
  input,
  onClose,
}: {
  input: {comment: HMUnsignedComment};
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"register" | "login" | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const userId = useSyncExternalStore(userIdentity.listen, userIdentity.get);

  return <SizableText>Huh?</SizableText>;
}

function useAuthDialog() {
  return useAppDialog(AuthDialogContent, {});
}

function generateTimetamp(): HMTimestamp {
  const now = new Date();
  return {
    seconds: BigInt(Math.floor(now.getTime() / 1000)),
    nanos: (now.getTime() % 1000) * 1000000,
  };
}

function createComment(text: string): HMUnsignedComment {
  return {
    content: [
      {
        block: {
          type: "Paragraph",
          text,
          attributes: {},
          annotations: [],
          id: "0",
        },
      },
    ],
    createTime: generateTimetamp(),
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

async function createWebIdentity() {
  // Check for existing key first
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

  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyB58 = bufferToB58(publicKeyRaw);

  async function signObject(data: any) {
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

  return {
    publicKey: publicKeyB58,
    signObject,
  };
}

export default function WebCommenting({docId}: {docId: UnpackedHypermediaId}) {
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const userId = useSyncExternalStore(
    userIdentity.listen,
    userIdentity.get,
    () => null
  );

  useEffect(() => {
    setReady(true);
  }, []);

  const authDialog = useAuthDialog();
  const submit = (
    <Button
      onPress={() => {
        createWebIdentity().then(({publicKey, signObject}) => {
          console.log("identity", publicKey);
          signObject({
            hello: 42,
          }).then((signature) => {
            console.log("signature", bufferToB58(signature));
          });
        });
      }}
    >
      Authenticate with {REQUESTING_PARTY_HOST}
    </Button>
  );
  return (
    <YStack borderRadius="$4" minHeight={105} bg="$color4">
      {ready ? <CommentEditor /> : null}
      {submit}
      {authDialog.content}
    </YStack>
  );
}
