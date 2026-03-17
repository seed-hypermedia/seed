import type {Database} from 'bun:sqlite'
import {afterAll, beforeAll, beforeEach, describe, expect, test} from 'bun:test'
import * as base64 from '@shm/shared/base64'
import * as encryption from '@shm/shared/encryption'
import {APIError, Service} from '@/api-service'
import type * as api from '@/api'
import type * as email from '@/email'
import * as crypto from '@/frontend/crypto'
import * as storage from '@/sqlite'

let db: Database

const rp = {
  id: 'localhost',
  name: 'Vault',
  origin: 'https://vault.example.com',
}

const hmacSecret = new Uint8Array(32).fill(7)
const emailSender: email.EmailSender = {
  sendLoginLink: async () => {},
}

beforeAll(() => {
  const result = storage.open(':memory:')
  if (!result.ok) throw new Error('unexpected schema mismatch')
  db = result.db
})

afterAll(() => {
  db?.close()
})

beforeEach(() => {
  db.run('PRAGMA foreign_keys = OFF')
  for (const table of db.query<{name: string}, []>("SELECT name FROM sqlite_schema WHERE type = 'table'").iterate()) {
    db.run(`DELETE FROM ${table.name}`)
  }
  db.run('PRAGMA foreign_keys = ON')
})

function createService() {
  return new Service(
    db,
    'https://daemon.example.com',
    {
      getAccount: async () => {
        throw new Error('not used in this test')
      },
    },
    rp,
    hmacSecret,
    emailSender,
  )
}

function createContext(sessionId: string | null = null): api.ServerContext {
  return {
    sessionId,
    challengeCookie: null,
  }
}

function createUser(email: string, id = `user-${Math.random().toString(36).slice(2)}`) {
  db.run(`INSERT INTO users (id, email, create_time) VALUES (?, ?, ?)`, [id, email.toLowerCase(), Date.now()])
  return id
}

function createSession(userId: string) {
  const sessionId = `session-${Math.random().toString(36).slice(2)}`
  db.run(`INSERT INTO sessions (id, user_id, expire_time, create_time) VALUES (?, ?, ?, ?)`, [
    sessionId,
    userId,
    Date.now() + 60_000,
    Date.now(),
  ])
  return sessionId
}

async function derivePasswordCredential(
  password: string,
  salt = base64.encode(crypto.generatePasswordSalt()),
  dek?: Uint8Array,
) {
  const masterKey = await encryption.deriveKeyFromPassword(password, base64.decode(salt), encryption.DEFAULT_PARAMS)
  const encryptionKey = await crypto.deriveEncryptionKey(masterKey)
  const authKey = await crypto.deriveAuthKey(masterKey)
  const plaintextDEK = dek ?? crypto.generateDEK()
  const encryptedDEK = await crypto.encrypt(plaintextDEK, encryptionKey)

  return {
    salt,
    dek: plaintextDEK,
    authKey: base64.encode(authKey),
    wrappedDEK: base64.encode(encryptedDEK),
    encryptionKey,
  }
}

function getPasswordCredentialRow(userId: string) {
  return db
    .query<
      {metadata: string; encrypted_dek: Uint8Array},
      [string, string]
    >(`SELECT metadata, encrypted_dek FROM credentials WHERE user_id = ? AND type = ?`)
    .get(userId, 'password')
}

describe('vault auth service', () => {
  test('addPassword stores a verifier, not the submitted auth key, and preLogin returns the password salt', async () => {
    const svc = createService()
    const email = 'password-user@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('SecurePassword123!')

    await expect(
      svc.addPassword(
        {
          encryptedDEK: password.wrappedDEK,
          authKey: password.authKey,
          salt: password.salt,
        },
        createContext(sessionId),
      ),
    ).resolves.toEqual({success: true})

    const stored = getPasswordCredentialRow(userId)
    expect(stored).not.toBeNull()

    const metadata = JSON.parse(stored!.metadata) as {
      authHash: string
      salt: string
    }

    expect(metadata.salt).toBe(password.salt)
    expect(metadata.authHash).not.toBe(password.authKey)

    await expect(svc.preLogin({email}, createContext())).resolves.toEqual({
      exists: true,
      hasPassword: true,
      salt: password.salt,
    })
  })

  test('login succeeds with the correct password and fails with the wrong one', async () => {
    const svc = createService()
    const email = 'login-user@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('CorrectHorseBatteryStaple!')

    await svc.addPassword(
      {
        encryptedDEK: password.wrappedDEK,
        authKey: password.authKey,
        salt: password.salt,
      },
      createContext(sessionId),
    )

    const loginCtx = createContext()
    await expect(
      svc.login(
        {
          email,
          authKey: password.authKey,
        },
        loginCtx,
      ),
    ).resolves.toEqual({
      success: true,
      userId,
    })
    expect(loginCtx.sessionCookie).toBeString()

    const wrongPassword = await derivePasswordCredential('wrong password', password.salt)
    await expect(
      svc.login(
        {
          email,
          authKey: wrongPassword.authKey,
        },
        createContext(),
      ),
    ).rejects.toMatchObject({statusCode: 401} as Partial<APIError>)
  })

  test('changePassword rotates the salt and invalidates the old password', async () => {
    const svc = createService()
    const email = 'change-password@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const initial = await derivePasswordCredential('OldPassword123!')

    await svc.addPassword(
      {
        encryptedDEK: initial.wrappedDEK,
        authKey: initial.authKey,
        salt: initial.salt,
      },
      createContext(sessionId),
    )

    const updated = await derivePasswordCredential('NewPassword456!', undefined, initial.dek)
    await expect(
      svc.changePassword(
        {
          encryptedDEK: updated.wrappedDEK,
          authKey: updated.authKey,
          salt: updated.salt,
        },
        createContext(sessionId),
      ),
    ).resolves.toEqual({success: true})

    const stored = getPasswordCredentialRow(userId)
    const metadata = JSON.parse(stored!.metadata) as {
      authHash: string
      salt: string
    }

    expect(metadata.salt).toBe(updated.salt)
    expect(metadata.salt).not.toBe(initial.salt)

    await expect(
      svc.login(
        {
          email,
          authKey: initial.authKey,
        },
        createContext(),
      ),
    ).rejects.toMatchObject({statusCode: 401} as Partial<APIError>)

    await expect(
      svc.login(
        {
          email,
          authKey: updated.authKey,
        },
        createContext(),
      ),
    ).resolves.toEqual({
      success: true,
      userId,
    })

    const decryptedDEK = await crypto.decrypt(new Uint8Array(stored!.encrypted_dek), updated.encryptionKey)
    expect(decryptedDEK).toEqual(initial.dek)
  })

  test('getVault returns encrypted data plus typed password and passkey credentials', async () => {
    const svc = createService()
    const email = 'vault-user@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('VaultPassword123!')
    const passkeyDEK = await crypto.encrypt(password.dek, new Uint8Array(32).fill(9))
    const encryptedData = await crypto.encrypt(new TextEncoder().encode('vault-payload'), password.dek)

    await svc.addPassword(
      {
        encryptedDEK: password.wrappedDEK,
        authKey: password.authKey,
        salt: password.salt,
      },
      createContext(sessionId),
    )

    db.run(`UPDATE users SET encrypted_data = ?, version = ? WHERE id = ?`, [encryptedData, 7, userId])
    db.run(
      `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'passkey-credential',
        userId,
        'passkey',
        passkeyDEK,
        JSON.stringify({
          credentialId: 'passkey-id',
          publicKey: 'public-key',
          counter: 0,
          backupEligible: true,
          backupState: true,
          prfEnabled: true,
        }),
        Date.now(),
      ],
    )

    await expect(svc.getVault(createContext(sessionId))).resolves.toEqual({
      encryptedData: base64.encode(encryptedData),
      version: 7,
      credentials: expect.arrayContaining([
        {
          kind: 'password',
          salt: password.salt,
          wrappedDEK: password.wrappedDEK,
        },
        {
          kind: 'passkey',
          credentialId: 'passkey-id',
          wrappedDEK: base64.encode(passkeyDEK),
        },
      ]),
    })
  })

  test('password login still works after email change because the salt is independent from email', async () => {
    const svc = createService()
    const oldEmail = 'before-change@test.com'
    const newEmail = 'after-change@test.com'
    const userId = createUser(oldEmail)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('EmailChangePassword123!')

    await svc.addPassword(
      {
        encryptedDEK: password.wrappedDEK,
        authKey: password.authKey,
        salt: password.salt,
      },
      createContext(sessionId),
    )

    db.run(`UPDATE users SET email = ? WHERE id = ?`, [newEmail, userId])

    await expect(svc.preLogin({email: newEmail}, createContext())).resolves.toEqual({
      exists: true,
      hasPassword: true,
      salt: password.salt,
    })

    await expect(
      svc.login(
        {
          email: newEmail,
          authKey: password.authKey,
        },
        createContext(),
      ),
    ).resolves.toEqual({
      success: true,
      userId,
    })
  })
})
