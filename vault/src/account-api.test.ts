import type {Database} from 'bun:sqlite'
import {Code, ConnectError} from '@connectrpc/connect'
import {beforeAll, describe, expect, test} from 'bun:test'
import {Account, Profile} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {APIError, Service} from '@/api-service'
import * as storage from '@/sqlite'

let db: Database

beforeAll(() => {
  const result = storage.open(':memory:')
  if (!result.ok) throw new Error('unexpected schema mismatch')
  db = result.db
})

const rp = {
  id: 'localhost',
  name: 'Vault',
  origin: 'https://vault.example.com',
}

const hmacSecret = new Uint8Array(32)
const emailSender = {
  sendLoginLink: async () => {},
}

function createService(getAccountImpl: (req: {id: string}) => Promise<Account>) {
  return new Service(
    db,
    'https://daemon.example.com',
    {
      getAccount: async (req) => getAccountImpl({id: req.id || ''}),
    },
    rp,
    hmacSecret,
    emailSender,
  )
}

describe('vault account api service', () => {
  test('serializes daemon accounts as proto json', async () => {
    const svc = createService(async ({id}) => {
      return new Account({
        id,
        profile: new Profile({
          name: 'Alice',
        }),
      })
    })

    await expect(svc.getAccount({id: 'alice'}, {sessionId: null, challengeCookie: null})).resolves.toEqual(
      new Account({
        id: 'alice',
        profile: new Profile({
          name: 'Alice',
        }),
      }),
    )
  })

  test('maps not found daemon errors to API errors', async () => {
    const svc = createService(async () => {
      throw new ConnectError('missing', Code.NotFound)
    })

    await expect(svc.getAccount({id: 'missing'}, {sessionId: null, challengeCookie: null})).rejects.toMatchObject({
      message: 'Account not found',
      statusCode: 404,
    } as Partial<APIError>)
  })

  test('returns frontend config from the service', async () => {
    const svc = createService(async ({id}) => new Account({id}))

    await expect(svc.getConfig({sessionId: null, challengeCookie: null})).resolves.toEqual({
      backendHttpBaseUrl: 'https://daemon.example.com',
    })
  })
})
