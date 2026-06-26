import type {Database} from 'bun:sqlite'
import {afterAll, beforeAll, beforeEach, describe, expect, spyOn, test} from 'bun:test'
import * as base64 from '@seed-hypermedia/client/base64'
import * as encryption from '@seed-hypermedia/client/encryption'
import * as webauthn from '@simplewebauthn/server'
import {APIError, Service} from '@/api-service'
import type * as api from '@/api'
import * as cookies from '@/cookies'
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
  sendVerificationEmail: async () => {},
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
  emailChallengeCookie: string | null = null,
): api.ServerContext {
  return {
    sessionId,
    bearerAuth,
    challengeCookie,
    emailChallengeCookie,
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
    .query<{metadata: string; encrypted_dek: Uint8Array}, [string, string]>(
      `SELECT metadata, encrypted_dek FROM credentials WHERE user_id = ? AND type = ?`,
    )
    .get(userId, 'password')
}

function getSecretCredentialRow(userId: string) {
  return db
    .query<{id: string; metadata: string; encrypted_dek: Uint8Array}, [string, string]>(
      `SELECT id, metadata, encrypted_dek FROM credentials WHERE user_id = ? AND type = ?`,
    )
    .get(userId, 'secret')
}

function getEmailChallenge(email: string) {
  return db
    .query<{email: string; binding_hash: string; code_hash: string; new_email: string | null}, [string]>(
      `SELECT email, binding_hash, code_hash, new_email FROM email_challenges WHERE email = ?`,
    )
    .get(email.toLowerCase())
}

function getEmailBindingCookie(ctx: api.ServerContext): string {
  const cookie = ctx.outboundEmailChallengeCookie
  if (!cookie) {
    throw new Error('Missing email challenge cookie')
  }
  const cookiePair = cookie.split(';')[0]!
  return cookiePair.slice(cookiePair.indexOf('=') + 1)
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

  test('registerStart rate-limits an active registration challenge', async () => {
    const sendVerificationEmail = spyOn(emailSender, 'sendVerificationEmail')
    const svc = createService()
    const email = 'active-registration@test.com'

    try {
      const firstCtx = createContext()
      const first = await svc.registerStart({email}, firstCtx)

      await expect(svc.registerStart({email}, createContext())).rejects.toMatchObject({
        statusCode: 429,
      })
      expect(first).toMatchObject({
        message: 'Verification code sent',
      })
      expect(first.expireTime).toBeGreaterThan(Date.now())
      expect(first.resendAllowedTime).toBeGreaterThan(Date.now())
      expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
      expect(getEmailChallenge(email)?.email).toBe(email)
      expect(getEmailBindingCookie(firstCtx)).toBeString()
    } finally {
      sendVerificationEmail.mockRestore()
    }
  })

  test('registerStart creates a new challenge after the previous one expires', async () => {
    const sendVerificationEmail = spyOn(emailSender, 'sendVerificationEmail')
    const svc = createService()
    const email = 'expired-registration@test.com'

    try {
      db.run(
        `INSERT INTO email_challenges (email, binding_hash, code_hash, new_email, attempt_count, create_time, expire_time) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [email, 'old-binding-hash', 'old-code-hash', null, 0, Date.now() - 120_000, Date.now() - 1],
      )

      const result = await svc.registerStart({email}, createContext())

      expect(result.expireTime).toBeGreaterThan(Date.now())
      expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
      expect(getEmailChallenge(email)?.binding_hash).not.toBe('old-binding-hash')
    } finally {
      sendVerificationEmail.mockRestore()
    }
  })

  test('registerStart removes a new challenge if sending the email fails', async () => {
    const sendVerificationEmail = spyOn(emailSender, 'sendVerificationEmail').mockImplementation(async () => {
      throw new Error('smtp unavailable')
    })
    const svc = createService()
    const email = 'send-failure@test.com'

    try {
      await expect(svc.registerStart({email}, createContext())).rejects.toThrow('smtp unavailable')
      expect(getEmailChallenge(email)).toBeNull()
    } finally {
      sendVerificationEmail.mockRestore()
    }
  })

  test('registerStart rejects an existing user with credentials', async () => {
    const sendVerificationEmail = spyOn(emailSender, 'sendVerificationEmail')
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
      expect(sendVerificationEmail).not.toHaveBeenCalled()
    } finally {
      sendVerificationEmail.mockRestore()
    }
  })

  test('registerVerify requires the same browser binding and correct code', async () => {
    const svc = createService()
    const email = 'verify-code@test.com'
    let code = ''
    const sendVerificationEmail = spyOn(emailSender, 'sendVerificationEmail').mockImplementation(
      async (_to, sentCode) => {
        code = sentCode
      },
    )

    try {
      const startCtx = createContext()
      await svc.registerStart({email}, startCtx)

      await expect(svc.registerVerify({code}, createContext())).rejects.toMatchObject({
        statusCode: 400,
      })

      const verifyCtx = createContext(null, null, null, getEmailBindingCookie(startCtx))
      const result = await svc.registerVerify({code}, verifyCtx)

      expect(result.verified).toBe(true)
      expect(result.userId).toBeString()
      expect(verifyCtx.sessionCookie).toBeString()
      expect(verifyCtx.outboundEmailChallengeCookie).toBeNull()
      expect(getEmailChallenge(email)).toBeNull()
    } finally {
      sendVerificationEmail.mockRestore()
    }
  })

  test('registerVerify deletes the challenge after three failed attempts', async () => {
    const svc = createService()
    const email = 'failed-code@test.com'
    let code = ''
    const sendVerificationEmail = spyOn(emailSender, 'sendVerificationEmail').mockImplementation(
      async (_to, sentCode) => {
        code = sentCode
      },
    )
    const startCtx = createContext()
    try {
      await svc.registerStart({email}, startCtx)
      const binding = getEmailBindingCookie(startCtx)
      const wrongCode = code === '0000' ? '0001' : '0000'

      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(
          svc.registerVerify({code: wrongCode}, createContext(null, null, null, binding)),
        ).rejects.toMatchObject({
          statusCode: 400,
        })
      }

      expect(getEmailChallenge(email)).toBeNull()
    } finally {
      sendVerificationEmail.mockRestore()
    }
  })

  test('registerVerify rejects when the email was claimed after start', async () => {
    const svc = createService()
    const email = 'claimed-registration@test.com'
    let code = ''
    const sendVerificationEmail = spyOn(emailSender, 'sendVerificationEmail').mockImplementation(
      async (_to, sentCode) => {
        code = sentCode
      },
    )

    try {
      const startCtx = createContext()
      await svc.registerStart({email}, startCtx)
      const userId = createUser(email)
      db.run(
        `INSERT INTO credentials (id, user_id, type, encrypted_dek, metadata, create_time) VALUES (?, ?, ?, ?, ?, ?)`,
        ['claimed-registration-credential', userId, 'password', null, null, Date.now()],
      )

      const verifyCtx = createContext(null, null, null, getEmailBindingCookie(startCtx))
      await expect(svc.registerVerify({code}, verifyCtx)).rejects.toMatchObject({
        message: 'User already exists',
        statusCode: 409,
      })
      expect(getEmailChallenge(email)).toBeNull()
      expect(verifyCtx.outboundEmailChallengeCookie).toBeNull()
      expect(verifyCtx.sessionCookie).toBeUndefined()
    } finally {
      sendVerificationEmail.mockRestore()
    }
  })

  test('changeEmailVerify requires the same browser binding and updates the user email', async () => {
    const svc = createService()
    const oldEmail = 'old-email@test.com'
    const newEmail = 'new-email@test.com'
    const userId = createUser(oldEmail)
    const sessionId = createSession(userId)
    let code = ''
    const sendVerificationEmail = spyOn(emailSender, 'sendVerificationEmail').mockImplementation(
      async (_to, sentCode) => {
        code = sentCode
      },
    )

    try {
      const startCtx = createContext(sessionId)
      const start = await svc.changeEmailStart({newEmail}, startCtx)

      expect(start.expireTime).toBeGreaterThan(Date.now())
      expect(getEmailChallenge(oldEmail)).toMatchObject({
        email: oldEmail,
        new_email: newEmail,
      })
      await expect(svc.changeEmailVerify({code}, createContext(sessionId))).rejects.toMatchObject({
        statusCode: 400,
      })

      const verifyCtx = createContext(sessionId, null, null, getEmailBindingCookie(startCtx))
      await expect(svc.changeEmailVerify({code}, verifyCtx)).resolves.toEqual({
        verified: true,
        newEmail,
      })
      expect(verifyCtx.outboundEmailChallengeCookie).toBeNull()
      expect(db.query<{email: string}, [string]>(`SELECT email FROM users WHERE id = ?`).get(userId)?.email).toBe(
        newEmail,
      )
      expect(getEmailChallenge(oldEmail)).toBeNull()
    } finally {
      sendVerificationEmail.mockRestore()
    }
  })

  test('changeEmailStart rate-limits reissuing a code for the same current email', async () => {
    const svc = createService()
    const userId = createUser('source-email@test.com')
    const sessionId = createSession(userId)
    const newEmail = 'limited-new-email@test.com'

    await svc.changeEmailStart({newEmail}, createContext(sessionId))

    await expect(svc.changeEmailStart({newEmail}, createContext(sessionId))).rejects.toMatchObject({
      statusCode: 429,
    })
  })

  test('changeEmailStart keys the challenge by current email', async () => {
    const svc = createService()
    const oldEmail = 'keyed-source@test.com'
    const newEmail = 'keyed-target@test.com'
    const userId = createUser(oldEmail)
    const sessionId = createSession(userId)

    await svc.changeEmailStart({newEmail}, createContext(sessionId))

    expect(getEmailChallenge(oldEmail)).toMatchObject({
      email: oldEmail,
      new_email: newEmail,
    })
    expect(getEmailChallenge(newEmail)).toBeNull()
  })

  test('changeEmailVerify rejects when the target email was claimed after start', async () => {
    const svc = createService()
    const oldEmail = 'race-source@test.com'
    const newEmail = 'race-target@test.com'
    const userId = createUser(oldEmail)
    const sessionId = createSession(userId)
    let code = ''
    const sendVerificationEmail = spyOn(emailSender, 'sendVerificationEmail').mockImplementation(
      async (_to, sentCode) => {
        code = sentCode
      },
    )

    try {
      const startCtx = createContext(sessionId)
      await svc.changeEmailStart({newEmail}, startCtx)
      createUser(newEmail)

      const verifyCtx = createContext(sessionId, null, null, getEmailBindingCookie(startCtx))
      await expect(svc.changeEmailVerify({code}, verifyCtx)).rejects.toMatchObject({
        message: 'Email already in use',
        statusCode: 409,
      })
      expect(getEmailChallenge(oldEmail)).toBeNull()
      expect(verifyCtx.outboundEmailChallengeCookie).toBeNull()
      expect(db.query<{email: string}, [string]>(`SELECT email FROM users WHERE id = ?`).get(userId)?.email).toBe(
        oldEmail,
      )
    } finally {
      sendVerificationEmail.mockRestore()
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
      .query<{id: string; encrypted_dek: Uint8Array}, [string, string]>(
        `SELECT id, encrypted_dek FROM credentials WHERE user_id = ? AND type = ? ORDER BY create_time ASC, id ASC`,
      )
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
      .query<{id: string; metadata: string; encrypted_dek: Uint8Array}, [string, string]>(
        `SELECT id, metadata, encrypted_dek FROM credentials WHERE user_id = ? AND type = ?`,
      )
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
        cookies.webauthnChallengeComputeHmac(hmacSecret, 'webauthn-register', 'passkey-register-challenge', sessionId),
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
        .query<{id: string; encrypted_dek: Uint8Array}, [string, string]>(
          `SELECT id, encrypted_dek FROM credentials WHERE user_id = ? AND type = ?`,
        )
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
            cookies.webauthnChallengeComputeHmac(
              hmacSecret,
              'webauthn-register',
              'passkey-register-challenge',
              sessionId,
            ),
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
      .query<{encrypted_data: Uint8Array; version: number}, [string]>(
        `SELECT encrypted_data, version FROM users WHERE id = ?`,
      )
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

    // Minting another credential is browser-only: a secret bearer must not be
    // able to add credentials (unlike vault data / password / email routes,
    // which the daemon may call with a bearer).
    await expect(
      svc.addSecretCredential(
        {
          authKey,
          wrappedDEK: password.wrappedDEK,
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

  test('Vault Connect payload creation requires a cookie session', async () => {
    const svc = createService()
    const userId = createUser('vault-connect@test.com')
    const sessionId = createSession(userId)
    const payload = base64.encode(new Uint8Array([1, 2, 3]))
    const req = {
      connectId: 'A'.repeat(43),
      payload,
    }

    await expect(svc.putVaultConnect(req, createContext())).rejects.toMatchObject({
      statusCode: 401,
    } as Partial<APIError>)

    await expect(svc.putVaultConnect(req, createContext(null, 'credential:auth'))).rejects.toMatchObject({
      statusCode: 401,
    } as Partial<APIError>)

    await expect(svc.putVaultConnect(req, createContext(sessionId))).resolves.toMatchObject({
      success: true,
    })

    const row = db
      .query<{payload: string}, [string]>(`SELECT payload FROM vault_connects WHERE id = ?`)
      .get(req.connectId)
    expect(row?.payload).toBe(payload)
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
