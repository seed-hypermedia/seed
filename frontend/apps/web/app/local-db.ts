import {Ability, AbilitySchema} from './auth-abilities'

function upgradeStore(
  db: IDBDatabase,
  storeName: string,
  options?: IDBObjectStoreParameters,
): IDBObjectStore {
  if (db.objectStoreNames.contains(storeName)) {
    return db.transaction(storeName, 'versionchange').objectStore(storeName)
  }
  return db.createObjectStore(storeName, options)
}

function upgradeIndex(
  store: IDBObjectStore,
  indexName: string,
  keyPath: string | string[],
  options?: IDBIndexParameters,
): IDBIndex {
  if (store.indexNames.contains(indexName)) {
    return store.index(indexName)
  }
  return store.createIndex(indexName, keyPath, options)
}

const DB_NAME = 'keyStore-04' // oops, can't change this, ever
const KEYS_STORE_NAME = 'keys-01'
const ABILITIES_STORE_NAME = 'abilities-01'
// const DELEGATED_ABILITIES_STORE_NAME = 'delegated-abilities-01'
const DELEGATED_IDENTITY_ORIGINS_STORE_NAME = 'delegated-identity-origins-01'
const DB_VERSION = 4

function promisify<
  Event,
  E,
  R extends {onsuccess: (event: Event) => void; onerror: (error: E) => {}},
>(req: R, onReq: (r: R) => void) {}

function initDB(db?: IDBFactory): Promise<IDBDatabase> {
  if (!db) {
    throw new Error('NoIndexedDB')
  }
  const openDb = db.open(DB_NAME, DB_VERSION)
  openDb.onupgradeneeded = (event) => {
    const db = event.target.result
    console.log(`Upgrading to version ${db.version}`)
    upgradeStore(db, KEYS_STORE_NAME)
    const abilitiesStore = upgradeStore(db, ABILITIES_STORE_NAME)
    upgradeIndex(abilitiesStore, 'delegateOrigin', 'delegateOrigin', {
      unique: false,
    })
    upgradeStore(db, DELEGATED_IDENTITY_ORIGINS_STORE_NAME)
  }
  return new Promise((resolve, reject) => {
    openDb.onsuccess = (event) => {
      console.log('~ db opened', openDb.result)
      resolve(openDb.result)
    }
    openDb.onerror = (error) => {
      console.error('~ error opening db', error)
      reject(error)
    }
  })
}

let db: Promise<IDBDatabase> = initDB(window.indexedDB)

export async function resetDB(idb: IDBFactory) {
  db = initDB(idb)
}

function storeGet<T>(store: IDBObjectStore, key: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const doGet = store.get(key)
    doGet.onsuccess = (event) => {
      resolve(event.target?.result)
    }
    doGet.onerror = (error) => {
      reject(error)
    }
  })
}

function storePut<T>(
  store: IDBObjectStore,
  value: T,
  key: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doGet = store.put(value, key)
    doGet.onsuccess = (event) => {
      resolve()
    }
    doGet.onerror = (error) => {
      reject(error)
    }
  })
}

function storeClear(store: IDBObjectStore): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = store.clear()
    r.onsuccess = () => {
      resolve()
    }
    r.onerror = (error) => {
      reject(error)
    }
  })
}

function storeDelete(store: IDBObjectStore, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = store.delete(key)
    r.onsuccess = () => {
      resolve()
    }
    r.onerror = (error) => {
      reject(error)
    }
  })
}

function storeGetAllKeys(store: IDBObjectStore): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const r = store.getAllKeys()
    r.onsuccess = (event) => {
      const keys = event.target.result
      resolve(keys.map((v) => v.toString()))
    }
    r.onerror = (error) => {
      reject(error)
    }
  })
}

function storeIndexGetAll<T>(store: IDBObjectStore | IDBIndex): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const r = store.getAll()
    r.onsuccess = (event) => {
      resolve(event.target.result)
    }
    r.onerror = (error) => {
      reject(error)
    }
  })
}

export async function getStoredLocalKeys(): Promise<CryptoKeyPair | null> {
  const store = (await db)
    .transaction(KEYS_STORE_NAME)
    .objectStore(KEYS_STORE_NAME)
  const [privateKey, publicKey] = await Promise.all([
    storeGet<CryptoKey>(store, 'privateKey'),
    storeGet<CryptoKey>(store, 'publicKey'),
  ])
  return privateKey && publicKey ? {privateKey, publicKey} : null
}

export async function writeLocalKeys(keyPair: CryptoKeyPair): Promise<void> {
  const store = (await db)
    .transaction(KEYS_STORE_NAME, 'readwrite')
    .objectStore(KEYS_STORE_NAME)
  console.log('~! writeLocalKeys', keyPair)
  await Promise.all([
    storePut(store, keyPair.privateKey, 'privateKey'),
    storePut(store, keyPair.publicKey, 'publicKey'),
  ])
}

export async function deleteLocalKeys() {
  const store = (await db)
    .transaction(KEYS_STORE_NAME, 'readwrite')
    .objectStore(KEYS_STORE_NAME)
  await storeClear(store)
}

export async function addDelegatedIdentityOrigin(
  origin: string,
): Promise<void> {
  const store = (await db)
    .transaction(DELEGATED_IDENTITY_ORIGINS_STORE_NAME, 'readwrite')
    .objectStore(DELEGATED_IDENTITY_ORIGINS_STORE_NAME)
  await storePut(store, '', origin)
}

export async function removeDelegatedIdentityOrigin(
  origin: string,
): Promise<void> {
  const store = (await db)
    .transaction(DELEGATED_IDENTITY_ORIGINS_STORE_NAME, 'readwrite')
    .objectStore(DELEGATED_IDENTITY_ORIGINS_STORE_NAME)
  await storeDelete(store, origin)
}

export async function getAllDelegatedIdentityOrigins(): Promise<string[]> {
  const store = (await db)
    .transaction(DELEGATED_IDENTITY_ORIGINS_STORE_NAME, 'readonly')
    .objectStore(DELEGATED_IDENTITY_ORIGINS_STORE_NAME)
  return await storeGetAllKeys(store)
}

export async function writeAbility(
  ability: Omit<Ability, 'id'>,
): Promise<Ability> {
  const id = crypto.randomUUID()
  const store = (await db)
    .transaction(ABILITIES_STORE_NAME, 'readwrite')
    .objectStore(ABILITIES_STORE_NAME)
  const writtenAbility = {...ability, id}
  await store.put(writtenAbility, id)
  return writtenAbility
}

export async function deleteAbility(id: string): Promise<void> {
  const store = (await db)
    .transaction(ABILITIES_STORE_NAME, 'readwrite')
    .objectStore(ABILITIES_STORE_NAME)
  await storeDelete(store, id)
}

export async function deleteAllAbilities(): Promise<void> {
  const store = (await db)
    .transaction(ABILITIES_STORE_NAME, 'readwrite')
    .objectStore(ABILITIES_STORE_NAME)
  await storeClear(store)
}

export async function getAllAbilities(): Promise<Ability[]> {
  const store = (await db)
    .transaction(ABILITIES_STORE_NAME, 'readonly')
    .objectStore(ABILITIES_STORE_NAME)
  const abilities = await storeIndexGetAll<Ability>(store)
  return abilities.map((ability) => {
    return AbilitySchema.parse(ability)
  })
}

export async function getAllAbilitiesByOrigin(
  origin: string,
): Promise<Ability[]> {
  const store = (await db)
    .transaction(ABILITIES_STORE_NAME, 'readonly')
    .objectStore(ABILITIES_STORE_NAME)
  const index = store.index('delegateOrigin')
  const abilities = await storeIndexGetAll<Ability>(index)
  return abilities.map((ability) => {
    return AbilitySchema.parse(ability)
  })
}
