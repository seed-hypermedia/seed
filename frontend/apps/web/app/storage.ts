const DB_NAME = "keyStore-04";
const KEYS_STORE_NAME = "keys-01";
const DB_VERSION = 1;

async function openDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEYS_STORE_NAME)) {
        db.createObjectStore(KEYS_STORE_NAME);
      }
    };
  });
}

export async function getStoredKeyPair(): Promise<CryptoKeyPair | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KEYS_STORE_NAME, "readonly");
    const store = transaction.objectStore(KEYS_STORE_NAME);
    const privateRequest = store.get("privateKey");
    const publicRequest = store.get("publicKey");

    let privateKey: CryptoKey | null = null;
    let publicKey: CryptoKey | null = null;

    privateRequest.onerror = () => reject(privateRequest.error);
    publicRequest.onerror = () => reject(publicRequest.error);

    privateRequest.onsuccess = () => {
      privateKey = privateRequest.result;
      if (publicKey !== null) {
        resolve(privateKey && publicKey ? { privateKey, publicKey } : null);
      }
    };

    publicRequest.onsuccess = () => {
      publicKey = publicRequest.result;
      if (privateKey !== null) {
        resolve(privateKey && publicKey ? { privateKey, publicKey } : null);
      }
    };
  });
}

export async function storeKeyPair(keyPair: CryptoKeyPair): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KEYS_STORE_NAME, "readwrite");
    const store = transaction.objectStore(KEYS_STORE_NAME);

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

export async function deleteKeyPair() {
  const db = await openDB();
  const transaction = db.transaction(KEYS_STORE_NAME, "readwrite");
  const store = transaction.objectStore(KEYS_STORE_NAME);
  store.clear();
}
