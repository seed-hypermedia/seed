import {IDBPDatabase, IDBPObjectStore, IDBPTransaction, openDB} from 'idb'
import {z} from 'zod'

function upgradeStore(
  db: IDBPDatabase,
  tx: IDBPTransaction<unknown, string[], 'versionchange'>,
  storeName: string,
) {
  if (!db.objectStoreNames.contains(storeName)) {
    return db.createObjectStore(storeName)
  }
  const store = tx.objectStore(storeName)
  return store
}

type UpgradeStore = IDBPObjectStore<
  unknown,
  ArrayLike<string>,
  string,
  'versionchange'
>

function upgradeIndex(store: UpgradeStore, indexName: string) {
  if (!store.indexNames.contains(indexName)) {
    return store.createIndex(indexName, indexName, {unique: false})
  }
  return store.index(indexName)
}

const DB_NAME = 'keyStore-04' // oops, can't change this, ever
const KEYS_STORE_NAME = 'keys-01'
const ABILITIES_STORE_NAME = 'abilities-01'
// const DELEGATED_ABILITIES_STORE_NAME = 'delegated-abilities-01'
const DELEGATED_IDENTITY_ORIGINS_STORE_NAME = 'delegated-identity-origins-01'
const DB_VERSION = 4

const db = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion, newVersion, tx, event) {
    upgradeStore(db, tx, KEYS_STORE_NAME)
    const abilitiesStore = upgradeStore(db, tx, ABILITIES_STORE_NAME)
    upgradeIndex(abilitiesStore, 'delegateOrigin')
    // upgradeStore(db, tx, DELEGATED_ABILITIES_STORE_NAME)
    upgradeStore(db, tx, DELEGATED_IDENTITY_ORIGINS_STORE_NAME)
  },
})

export async function getStoredLocalKeys(): Promise<CryptoKeyPair | null> {
  const store = (await db)
    .transaction(KEYS_STORE_NAME)
    .objectStore(KEYS_STORE_NAME)
  const [privateKey, publicKey] = await Promise.all([
    store.get('privateKey') as Promise<CryptoKey>,
    store.get('publicKey') as Promise<CryptoKey>,
  ])
  return privateKey && publicKey ? {privateKey, publicKey} : null
}

export async function writeLocalKeys(keyPair: CryptoKeyPair): Promise<void> {
  const store = (await db)
    .transaction(KEYS_STORE_NAME, 'readwrite')
    .objectStore(KEYS_STORE_NAME)
  await Promise.all([
    store.put(keyPair.privateKey, 'privateKey'),
    store.put(keyPair.publicKey, 'publicKey'),
  ])
}

export async function deleteLocalKeys() {
  const store = (await db)
    .transaction(KEYS_STORE_NAME, 'readwrite')
    .objectStore(KEYS_STORE_NAME)
  await store.clear()
}

export const AbilitySchema = z.object({
  id: z.string(),
  accountUid: z.string(),
  accountPublicKey: z.instanceof(Uint8Array),
  targetPath: z.array(z.string()),
  targetUid: z.string().nullable(),
  mode: z.enum(['comment', 'all']),
  expiration: z.number().nullable(),
  recursive: z.boolean(),
  delegateOrigin: z.string(),
  identityOrigin: z.string(),
})

export type Ability = z.infer<typeof AbilitySchema>

export async function addDelegatedIdentityOrigin(
  origin: string,
): Promise<void> {
  console.log('STORING ORIGIN addDelegatedIdentityOrigin', origin)
  const store = (await db)
    .transaction(DELEGATED_IDENTITY_ORIGINS_STORE_NAME, 'readwrite')
    .objectStore(DELEGATED_IDENTITY_ORIGINS_STORE_NAME)
  await store.put('', origin)
}

export async function getAllDelegatedIdentityOrigins(): Promise<string[]> {
  const store = (await db)
    .transaction(DELEGATED_IDENTITY_ORIGINS_STORE_NAME, 'readonly')
    .objectStore(DELEGATED_IDENTITY_ORIGINS_STORE_NAME)
  const keys = await store.getAllKeys()
  return keys.map((v) => v.toString())
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
  await store.delete(id)
}

export async function getAllAbilities(): Promise<Ability[]> {
  const store = (await db)
    .transaction(ABILITIES_STORE_NAME, 'readonly')
    .objectStore(ABILITIES_STORE_NAME)
  return store.getAll()
}

export async function getAllAbilitiesByOrigin(
  origin: string,
): Promise<Ability[]> {
  const store = (await db)
    .transaction(ABILITIES_STORE_NAME, 'readonly')
    .objectStore(ABILITIES_STORE_NAME)
  const index = store.index('delegateOrigin')
  const abilities = await index.getAll(origin)
  return abilities.map((ability) => {
    return AbilitySchema.parse(ability)
  })
}
