import type {Database} from 'bun:sqlite'
import {afterAll, beforeAll, beforeEach, describe, expect, spyOn, test} from 'bun:test'
import * as base64 from '@shm/shared/base64'
import * as encryption from '@shm/shared/encryption'
import * as webauthn from '@simplewebauthn/server'
import {APIError, Service} from '@/api-service'
import type * as api from '@/api'
import * as challenge from '@/challenge'
import type * as email from '@/email'
import * as crypto from '@/frontend/crypto'
import * as storage from '@/sqlite'

let db: Database

const rp = {
  id: 'localhost',
  name: 'Vault',
  origin: 'https://example.com',
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

const mockGrpcClient = {
  documents: {
    getAccount: async () => {
      throw new Error('not used in this test')
    },
  },
  daemon: {
    listKeys: async () => ({keys: []}),
    signData: async () => ({signature: new Uint8Array()}),
  },
} as any

function createService() {
  return new Service(
    db,
    'https://daemon.example.com',
    'https://notify.example.com',
    mockGrpcClient,
    rp,
    hmacSecret,
    emailSender,
  )
}

function createContext(
  sessionId: string | null = null,
  bearerAuth: string | null = null,
  challengeCookie: string | null = null,
): api.ServerContext {
  return {
    sessionId,
    bearerAuth,
    challengeCookie,
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

function getSecretCredentialRow(userId: string) {
  return db
    .query<
      {id: string; metadata: string; encrypted_dek: Uint8Array},
      [string, string]
    >(`SELECT id, metadata, encrypted_dek FROM credentials WHERE user_id = ? AND type = ?`)
    .get(userId, 'secret')
}

function getRegistrationChallenge(email: string) {
  return db
    .query<{id: string}, [string]>(`SELECT id FROM email_challenges WHERE email = ? AND purpose = 'registration'`)
    .get(email.toLowerCase())
}

function generateSecret(): string {
  return base64.encode(globalThis.crypto.getRandomValues(new Uint8Array(32)))
}

async function deriveSecretCredentialAuthKey(secret: string): Promise<string> {
  return base64.encode(await crypto.deriveSecretCredentialAuthKey(base64.decode(secret)))
}

describe('vault auth service', () => {
  test('getSession reports credentials by type', async () => {
    const svc = createService()
    const email = 'session-credentials@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('SessionPassword123!')

    await svc.addPassword(
      {
        wrappedDEK: password.wrappedDEK,
        authKey: password.authKey,
        salt: password.salt,
      },
      createContext(sessionId),
    )

    await expect(svc.getSession(createContext(sessionId))).resolves.toEqual({
      authenticated: true,
      relyingPartyOrigin: rp.origin,
      userId,
      email,
      credentials: {
        password: true,
      },
    })
  })

  test('preLogin reports existing users without credentials so the client can restart verification', async () => {
    const svc = createService()
    const email = 'no-credentials@test.com'

    createUser(email)

    await expect(svc.preLogin({email}, createContext())).resolves.toEqual({
      exists: true,
      credentials: {},
    })
  })

  test('registerStart reuses an active registration challenge without sending another email', async () => {
    const sendLoginLink = spyOn(emailSender, 'sendLoginLink')
    const svc = createService()
    const email = 'active-registration@test.com'

    try {
      const first = await svc.registerStart({email}, createContext())
      const second = await svc.registerStart({email}, createContext())

      expect(second.challengeId).toBe(first.challengeId)
      expect(sendLoginLink).toHaveBeenCalledTimes(1)
      expect(getRegistrationChallenge(email)?.id).toBe(first.challengeId)
    } finally {
      sendLoginLink.mockRestore()
    }
  })

  test('registerStart creates a new challenge after the previous one expires', async () => {
    const sendLoginLink = spyOn(emailSender, 'sendLoginLink')
    const svc = createService()
    const email = 'expired-registration@test.com'

    try {
      db.run(
        `INSERT INTO email_challenges (id, user_id, purpose, token_hash, email, verified, expire_time) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['expired-challenge', null, 'registration', 'expired-token-hash', email, 0, Date.now() - 1],
      )

      const result = await svc.registerStart({email}, createContext())

      expect(result.challengeId).not.toBe('expired-challenge')
      expect(sendLoginLink).toHaveBeenCalledTimes(1)
      expect(getRegistrationChallenge(email)?.id).toBe(result.challengeId)
    } finally {
      sendLoginLink.mockRestore()
    }
  })

  test('registerStart removes a new challenge if sending the email fails', async () => {
    const sendLoginLink = spyOn(emailSender, 'sendLoginLink').mockImplementation(async () => {
      throw new Error('smtp unavailable')
    })
    const svc = createService()
    const email = 'send-failure@test.com'

    try {
      await expect(svc.registerStart({email}, createContext())).rejects.toThrow('smtp unavailable')
      expect(getRegistrationChallenge(email)).toBeNull()
    } finally {
      sendLoginLink.mockRestore()
    }
  })

  test('registerStart rejects an existing user with credentials', async () => {
    const sendLoginLink = spyOn(emailSender, 'sendLoginLink')
    const svc = createService()
    const email = 'registered-user@test.com'
    const userId = createUser(email)

    try {
      db.run(
        `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
        ['registered-credential', userId, 'password', null, null, Date.now()],
      )

      await expect(svc.registerStart({email}, createContext())).rejects.toMatchObject({
        message: 'User already exists',
        statusCode: 409,
      })
      expect(sendLoginLink).not.toHaveBeenCalled()
    } finally {
      sendLoginLink.mockRestore()
    }
  })

  test('addPassword stores a verifier, not the submitted auth key, and preLogin returns the password salt', async () => {
    const svc = createService()
    const email = 'password-user@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('SecurePassword123!')

    await expect(
      svc.addPassword(
        {
          wrappedDEK: password.wrappedDEK,
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
      credentials: {
        password: true,
      },
      salt: password.salt,
    })
  })

  test('addSecretCredential stores a verifier for the derived auth key', async () => {
    const svc = createService()
    const email = 'secret-credential@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('SecretCredentialPassword123!')
    const secret = generateSecret()
    const authKey = await deriveSecretCredentialAuthKey(secret)

    await expect(
      svc.addSecretCredential(
        {
          authKey,
          wrappedDEK: password.wrappedDEK,
        },
        createContext(sessionId),
      ),
    ).resolves.toMatchObject({success: true})

    const stored = getSecretCredentialRow(userId)
    expect(stored).not.toBeNull()

    const metadata = JSON.parse(stored!.metadata) as {
      authHash: string
    }

    expect(metadata.authHash).not.toBe(authKey)
  })

  test('addSecretCredential keeps multiple secret credentials for the same user', async () => {
    const svc = createService()
    const email = 'secret-upsert@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const initial = await derivePasswordCredential('InitialSecretCredentialPassword123!')
    const updated = await derivePasswordCredential('UpdatedSecretCredentialPassword456!')
    const firstSecret = generateSecret()
    const secondSecret = generateSecret()
    const firstAuthKey = await deriveSecretCredentialAuthKey(firstSecret)
    const secondAuthKey = await deriveSecretCredentialAuthKey(secondSecret)

    const first = await svc.addSecretCredential(
      {
        authKey: firstAuthKey,
        wrappedDEK: initial.wrappedDEK,
      },
      createContext(sessionId),
    )

    const second = await svc.addSecretCredential(
      {
        authKey: secondAuthKey,
        wrappedDEK: updated.wrappedDEK,
      },
      createContext(sessionId),
    )

    expect(second.success).toBe(true)
    expect(second.credentialId).not.toBe(first.credentialId)

    const rows = db
      .query<
        {id: string; encrypted_dek: Uint8Array},
        [string, string]
      >(`SELECT id, encrypted_dek FROM credentials WHERE user_id = ? AND type = ? ORDER BY create_time ASC, id ASC`)
      .all(userId, 'secret')

    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.id))).toEqual(new Set([first.credentialId, second.credentialId]))

    const encryptedDEKByID = new Map(rows.map((row) => [row.id, base64.encode(new Uint8Array(row.encrypted_dek))]))
    expect(encryptedDEKByID.get(first.credentialId)).toBe(initial.wrappedDEK)
    expect(encryptedDEKByID.get(second.credentialId)).toBe(updated.wrappedDEK)
  })

  test('shared vault routes accept cookie auth and direct secret bearer auth', async () => {
    const svc = createService()
    const email = 'daemon-bearer-only@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('DaemonBearerOnlyPassword123!')
    const secret = generateSecret()
    const authKey = await deriveSecretCredentialAuthKey(secret)

    const secretCredential = await svc.addSecretCredential(
      {
        authKey,
        wrappedDEK: password.wrappedDEK,
      },
      createContext(sessionId),
    )

    await expect(svc.getVault({}, createContext(sessionId))).resolves.toMatchObject({
      version: 1,
      credentials: expect.arrayContaining([
        {
          kind: 'secret',
          credentialId: expect.any(String),
          wrappedDEK: password.wrappedDEK,
        },
      ]),
    })

    const secretBearer = `${secretCredential.credentialId}:${authKey}`
    await expect(svc.getVault({}, createContext(null, secretBearer))).resolves.toMatchObject({
      version: 1,
      credentials: expect.arrayContaining([
        {
          kind: 'secret',
          credentialId: secretCredential.credentialId,
          wrappedDEK: password.wrappedDEK,
        },
      ]),
    })

    await expect(
      svc.saveVault(
        {
          encryptedData: base64.encode(await crypto.encrypt(new TextEncoder().encode('payload'), password.dek)),
          version: 1,
        },
        createContext(null, secretBearer),
      ),
    ).resolves.toEqual({success: true})
  })

  test('login succeeds with the correct password and fails with the wrong one', async () => {
    const svc = createService()
    const email = 'login-user@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('CorrectHorseBatteryStaple!')

    await svc.addPassword(
      {
        wrappedDEK: password.wrappedDEK,
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
        wrappedDEK: initial.wrappedDEK,
        authKey: initial.authKey,
        salt: initial.salt,
      },
      createContext(sessionId),
    )

    const updated = await derivePasswordCredential('NewPassword456!', undefined, initial.dek)
    await expect(
      svc.changePassword(
        {
          wrappedDEK: updated.wrappedDEK,
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

  test('addPassword rejects duplicate password setup and preserves the original wrapped DEK', async () => {
    const svc = createService()
    const userId = createUser('password-upsert@test.com')
    const sessionId = createSession(userId)
    const initial = await derivePasswordCredential('InitialPassword123!')
    const updated = await derivePasswordCredential('UpdatedPassword456!', undefined, initial.dek)

    await svc.addPassword(
      {
        wrappedDEK: initial.wrappedDEK,
        authKey: initial.authKey,
        salt: initial.salt,
      },
      createContext(sessionId),
    )

    await expect(
      svc.addPassword(
        {
          wrappedDEK: updated.wrappedDEK,
          authKey: updated.authKey,
          salt: updated.salt,
        },
        createContext(sessionId),
      ),
    ).rejects.toMatchObject({statusCode: 409} as Partial<APIError>)

    const rows = db
      .query<
        {id: string; metadata: string; encrypted_dek: Uint8Array},
        [string, string]
      >(`SELECT id, metadata, encrypted_dek FROM credentials WHERE user_id = ? AND type = ?`)
      .all(userId, 'password')

    expect(rows).toHaveLength(1)
    expect(base64.encode(new Uint8Array(rows[0]!.encrypted_dek))).toBe(initial.wrappedDEK)
    expect((JSON.parse(rows[0]!.metadata) as {salt: string}).salt).toBe(initial.salt)
  })

  test('addPasskeyFinish stores wrappedDEK inline when provided', async () => {
    const verifyRegistrationResponse = spyOn(webauthn, 'verifyRegistrationResponse')
    try {
      const svc = createService()
      const userId = createUser('passkey-finish@test.com')
      const sessionId = createSession(userId)
      const clientDataJSON = base64.encode(
        new TextEncoder().encode(
          JSON.stringify({
            challenge: 'passkey-register-challenge',
          }),
        ),
      )

      verifyRegistrationResponse
        .mockResolvedValueOnce({
          verified: true,
          registrationInfo: {
            credential: {
              id: new Uint8Array([1, 2, 3]),
              publicKey: new Uint8Array([4, 5, 6]),
              counter: 0,
            },
            credentialDeviceType: 'multiDevice',
            credentialBackedUp: true,
          },
        } as unknown as Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>)
        .mockResolvedValueOnce({
          verified: true,
          registrationInfo: {
            credential: {
              id: new Uint8Array([7, 8, 9]),
              publicKey: new Uint8Array([10, 11, 12]),
              counter: 0,
            },
            credentialDeviceType: 'singleDevice',
            credentialBackedUp: false,
          },
        } as unknown as Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>)

      const firstCtx = createContext(
        sessionId,
        null,
        challenge.computeHmac(hmacSecret, 'webauthn-register', 'passkey-register-challenge', sessionId),
      )

      const inlineWrappedDEK = base64.encode(new Uint8Array([21, 22, 23]))
      const inlineResult = await svc.addPasskeyFinish(
        {
          response: {
            id: 'inline-passkey',
            rawId: 'inline-passkey',
            type: 'public-key',
            clientExtensionResults: {},
            response: {
              clientDataJSON,
              attestationObject: base64.encode(new Uint8Array([13, 14, 15])),
              transports: ['internal'],
            },
          },
          wrappedDEK: inlineWrappedDEK,
        },
        firstCtx,
      )

      const rows = db
        .query<
          {id: string; encrypted_dek: Uint8Array},
          [string, string]
        >(`SELECT id, encrypted_dek FROM credentials WHERE user_id = ? AND type = ?`)
        .all(userId, 'passkey')

      expect(inlineResult.success).toBe(true)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(inlineResult.credentialId)
      expect(base64.encode(new Uint8Array(rows[0]!.encrypted_dek))).toBe(inlineWrappedDEK)
    } finally {
      verifyRegistrationResponse.mockRestore()
    }
  })

  test('addPasskeyFinish rejects registration when wrappedDEK is missing', async () => {
    const verifyRegistrationResponse = spyOn(webauthn, 'verifyRegistrationResponse')
    try {
      const svc = createService()
      const userId = createUser('passkey-missing-dek@test.com')
      const sessionId = createSession(userId)
      const clientDataJSON = base64.encode(
        new TextEncoder().encode(
          JSON.stringify({
            challenge: 'passkey-register-challenge',
          }),
        ),
      )

      verifyRegistrationResponse.mockResolvedValueOnce({
        verified: true,
        registrationInfo: {
          credential: {
            id: new Uint8Array([7, 8, 9]),
            publicKey: new Uint8Array([10, 11, 12]),
            counter: 0,
          },
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
        },
      } as unknown as Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>)

      await expect(
        svc.addPasskeyFinish(
          {
            response: {
              id: 'deferred-passkey',
              rawId: 'deferred-passkey',
              type: 'public-key',
              clientExtensionResults: {},
              response: {
                clientDataJSON,
                attestationObject: base64.encode(new Uint8Array([16, 17, 18])),
                transports: ['hybrid'],
              },
            },
          } as api.AddPasskeyFinishRequest,
          createContext(
            sessionId,
            null,
            challenge.computeHmac(hmacSecret, 'webauthn-register', 'passkey-register-challenge', sessionId),
          ),
        ),
      ).rejects.toMatchObject({statusCode: 400} as Partial<APIError>)

      const rows = db
        .query<{id: string}, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
        .all(userId, 'passkey')
      expect(rows).toHaveLength(0)
    } finally {
      verifyRegistrationResponse.mockRestore()
    }
  })

  test('getVault returns encrypted data plus typed password, passkey, and secret credentials', async () => {
    const svc = createService()
    const email = 'vault-user@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('VaultPassword123!')
    const passkeyDEK = await crypto.encrypt(password.dek, new Uint8Array(32).fill(9))
    const encryptedData = await crypto.encrypt(new TextEncoder().encode('vault-payload'), password.dek)

    await svc.addPassword(
      {
        wrappedDEK: password.wrappedDEK,
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
    db.run(
      `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'secret-credential',
        userId,
        'secret',
        passkeyDEK,
        JSON.stringify({
          authHash: base64.encode(new Uint8Array(32).fill(11)),
        }),
        Date.now(),
      ],
    )

    await expect(svc.getVault({}, createContext(sessionId))).resolves.toEqual({
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
        {
          kind: 'secret',
          credentialId: 'secret-credential',
          wrappedDEK: base64.encode(passkeyDEK),
        },
      ]),
    })
  })

  test('getVault supports version-aware no-change responses for secret bearer auth', async () => {
    const svc = createService()
    const email = 'daemon-version-aware@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('DaemonVersionAwarePassword123!')
    const secret = generateSecret()
    const authKey = await deriveSecretCredentialAuthKey(secret)
    const encryptedData = await crypto.encrypt(new TextEncoder().encode('daemon-vault-payload'), password.dek)

    const secretCredential = await svc.addSecretCredential(
      {
        authKey,
        wrappedDEK: password.wrappedDEK,
      },
      createContext(sessionId),
    )
    db.run(`UPDATE users SET encrypted_data = ?, version = ? WHERE id = ?`, [encryptedData, 9, userId])

    const secretBearer = `${secretCredential.credentialId}:${authKey}`
    await expect(svc.getVault({knownVersion: 9}, createContext(null, secretBearer))).resolves.toEqual({
      unchanged: true,
    })

    await expect(svc.getVault({knownVersion: 8}, createContext(null, secretBearer))).resolves.toMatchObject({
      encryptedData: base64.encode(encryptedData),
      version: 9,
      credentials: expect.arrayContaining([
        {
          kind: 'secret',
          credentialId: secretCredential.credentialId,
          wrappedDEK: password.wrappedDEK,
        },
      ]),
    })
  })

  test('saveVault writes encrypted data and enforces optimistic version checks for secret bearer auth', async () => {
    const svc = createService()
    const email = 'daemon-save-vault@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('DaemonSavePassword123!')
    const secret = generateSecret()
    const authKey = await deriveSecretCredentialAuthKey(secret)
    const initialCiphertext = await crypto.encrypt(new TextEncoder().encode('initial-daemon-payload'), password.dek)
    const updatedCiphertext = await crypto.encrypt(new TextEncoder().encode('updated-daemon-payload'), password.dek)

    const secretCredential = await svc.addSecretCredential(
      {
        authKey,
        wrappedDEK: password.wrappedDEK,
      },
      createContext(sessionId),
    )
    db.run(`UPDATE users SET encrypted_data = ?, version = ? WHERE id = ?`, [initialCiphertext, 5, userId])

    const bearerCtx = createContext(null, `${secretCredential.credentialId}:${authKey}`)

    await expect(
      svc.saveVault(
        {
          encryptedData: base64.encode(updatedCiphertext),
          version: 5,
        },
        bearerCtx,
      ),
    ).resolves.toEqual({success: true})

    const user = db
      .query<
        {encrypted_data: Uint8Array; version: number},
        [string]
      >(`SELECT encrypted_data, version FROM users WHERE id = ?`)
      .get(userId)

    expect(user).not.toBeNull()
    expect(user!.version).toBe(6)
    expect(base64.encode(user!.encrypted_data)).toBe(base64.encode(updatedCiphertext))

    await expect(
      svc.saveVault(
        {
          encryptedData: base64.encode(initialCiphertext),
          version: 5,
        },
        bearerCtx,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
    } as Partial<APIError>)
  })

  test('malformed secret bearer values are rejected', async () => {
    const svc = createService()

    await expect(svc.getVault({}, createContext(null, 'missing-colon'))).rejects.toMatchObject({
      statusCode: 400,
    } as Partial<APIError>)

    await expect(svc.getVault({}, createContext(null, ':auth-key'))).rejects.toMatchObject({
      statusCode: 400,
    } as Partial<APIError>)

    await expect(svc.getVault({}, createContext(null, 'cred-1:'))).rejects.toMatchObject({
      statusCode: 400,
    } as Partial<APIError>)
  })

  test('unknown credential ID is rejected for secret bearer auth', async () => {
    const svc = createService()

    await expect(svc.getVault({}, createContext(null, 'missing-credential:Zm9v'))).rejects.toMatchObject({
      statusCode: 401,
    } as Partial<APIError>)
  })

  test('wrong auth key for a known secret credential is rejected', async () => {
    const svc = createService()
    const userId = createUser('wrong-secret-auth@test.com')
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('WrongSecretAuth123!')
    const secret = generateSecret()
    const authKey = await deriveSecretCredentialAuthKey(secret)

    const secretCredential = await svc.addSecretCredential(
      {
        authKey,
        wrappedDEK: password.wrappedDEK,
      },
      createContext(sessionId),
    )

    const wrongAuthKey = await deriveSecretCredentialAuthKey(generateSecret())
    await expect(
      svc.getVault({}, createContext(null, `${secretCredential.credentialId}:${wrongAuthKey}`)),
    ).rejects.toMatchObject({
      statusCode: 401,
    } as Partial<APIError>)
  })

  test('non-secret credential IDs are rejected for secret bearer auth', async () => {
    const svc = createService()
    const userId = createUser('non-secret-bearer@test.com')
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('NonSecretBearer123!')

    await svc.addPassword(
      {
        wrappedDEK: password.wrappedDEK,
        authKey: password.authKey,
        salt: password.salt,
      },
      createContext(sessionId),
    )

    const passwordCredential = db
      .query<{id: string}, [string, string]>(`SELECT id FROM credentials WHERE user_id = ? AND type = ?`)
      .get(userId, 'password')

    expect(passwordCredential).not.toBeNull()
    await expect(
      svc.getVault({}, createContext(null, `${passwordCredential!.id}:${password.authKey}`)),
    ).rejects.toMatchObject({
      statusCode: 401,
    } as Partial<APIError>)
  })

  test('browser-only routes do not accept secret bearer auth as a session substitute', async () => {
    const svc = createService()
    const userId = createUser('browser-only-routes@test.com')
    const sessionId = createSession(userId)
    const password = await derivePasswordCredential('BrowserOnlyRoutes123!')
    const secret = generateSecret()
    const authKey = await deriveSecretCredentialAuthKey(secret)

    const secretCredential = await svc.addSecretCredential(
      {
        authKey,
        wrappedDEK: password.wrappedDEK,
      },
      createContext(sessionId),
    )

    await expect(
      svc.addPassword(
        {
          wrappedDEK: password.wrappedDEK,
          authKey: password.authKey,
          salt: password.salt,
        },
        createContext(null, `${secretCredential.credentialId}:${authKey}`),
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
    } as Partial<APIError>)

    await expect(svc.getSession(createContext(null, `${secretCredential.credentialId}:${authKey}`))).resolves.toEqual({
      authenticated: false,
      relyingPartyOrigin: rp.origin,
    })
  })

  test('addPasskeyStart requires user verification', async () => {
    const svc = createService()
    const email = 'passkey-register@test.com'
    const userId = createUser(email)
    const sessionId = createSession(userId)

    const response = await svc.addPasskeyStart(createContext(sessionId))

    expect(response.authenticatorSelection?.userVerification).toBe('required')
  })

  test('loginPasskeyStart lets the browser choose the authenticator path for passkeys', async () => {
    const svc = createService()
    const email = 'passkey-login@test.com'
    const userId = createUser(email)

    db.run(
      `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'passkey-credential',
        userId,
        'passkey',
        new Uint8Array([1, 2, 3]),
        JSON.stringify({
          credentialId: 'passkey-id',
          publicKey: 'public-key',
          counter: 0,
          transports: ['internal'],
          backupEligible: true,
          backupState: true,
          prfEnabled: true,
        }),
        Date.now(),
      ],
    )
    db.run(
      `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'broken-passkey',
        userId,
        'passkey',
        null,
        JSON.stringify({
          credentialId: 'broken-passkey-id',
          publicKey: 'public-key',
          counter: 0,
          transports: ['internal'],
          backupEligible: true,
          backupState: true,
          prfEnabled: true,
        }),
        Date.now(),
      ],
    )

    const response = await svc.loginPasskeyStart({email}, createContext())

    expect(response.userVerification).toBe('required')
    expect(response.allowCredentials).toEqual([
      {
        id: 'passkey-id',
        type: 'public-key',
      },
    ])
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
        wrappedDEK: password.wrappedDEK,
        authKey: password.authKey,
        salt: password.salt,
      },
      createContext(sessionId),
    )

    db.run(`UPDATE users SET email = ? WHERE id = ?`, [newEmail, userId])

    await expect(svc.preLogin({email: newEmail}, createContext())).resolves.toEqual({
      exists: true,
      credentials: {
        password: true,
      },
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
