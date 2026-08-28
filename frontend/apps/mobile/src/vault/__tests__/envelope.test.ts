import {createRemoteSyncState, parseEnvelope, serializeEnvelope, type VaultEnvelope} from '../envelope'

const bytes = (...values: number[]) => Uint8Array.from(values)

describe('vault envelope codec (Go file.go parity)', () => {
  test('round-trips a local-mode envelope and omits empty fields', () => {
    const envelope: VaultEnvelope = {
      encryptedData: bytes(1, 2, 3, 4),
      wrappedDEK: bytes(9, 8, 7),
      credentials: [],
      remote: null,
    }
    const json = serializeEnvelope(envelope)
    const raw = JSON.parse(json)
    // Go omitempty: no credentials/remote keys at all in local mode.
    expect(Object.keys(raw)).toEqual(['encryptedData', 'wrappedDEK'])
    // []byte marshals to PADDED standard base64 in Go.
    expect(raw.encryptedData).toBe('AQIDBA==')
    expect(raw.wrappedDEK).toBe('CQgH')

    const parsed = parseEnvelope(json)
    expect(Array.from(parsed.encryptedData)).toEqual([1, 2, 3, 4])
    expect(Array.from(parsed.wrappedDEK)).toEqual([9, 8, 7])
    expect(parsed.credentials).toEqual([])
    expect(parsed.remote).toBeNull()
  })

  test('round-trips a remote envelope with sync fields (lastSyncTime in seconds)', () => {
    const envelope: VaultEnvelope = {
      encryptedData: bytes(1),
      wrappedDEK: bytes(2),
      credentials: [{kind: 'secret', credentialId: 'cred-1', wrappedDEK: 'AbC_d-9'}],
      remote: createRemoteSyncState({
        vaultUrl: 'https://hyper.media/vault',
        userId: 'user-1',
        credentialId: 'cred-1',
        localVersion: 3,
        remoteVersion: 7,
        syncedLocalVersion: 3,
        lastSyncTime: 1_755_800_000, // unix SECONDS, kept as-is
        lastSyncError: '',
      }),
    }
    const parsed = parseEnvelope(serializeEnvelope(envelope))
    expect(parsed.remote).toEqual(envelope.remote)
    expect(parsed.credentials).toEqual(envelope.credentials)
  })

  test('zero-valued remote sync fields are omitted (Go omitempty)', () => {
    const envelope: VaultEnvelope = {
      encryptedData: bytes(1),
      wrappedDEK: bytes(2),
      credentials: [],
      remote: createRemoteSyncState({vaultUrl: 'https://v.example', userId: 'u', credentialId: 'c'}),
    }
    const raw = JSON.parse(serializeEnvelope(envelope))
    expect(Object.keys(raw.remote)).toEqual(['vaultUrl', 'userId', 'credentialId'])
    // Parsing restores the zero values.
    const parsed = parseEnvelope(serializeEnvelope(envelope))
    expect(parsed.remote).toEqual(envelope.remote)
  })

  test('parses a Go-formatted envelope fixture', () => {
    // Field shapes exactly as backend/storage/vault writes them.
    const goJson = JSON.stringify({
      encryptedData: 'AQIDBA==',
      wrappedDEK: 'CQgH',
      credentials: [{kind: 'secret', credentialId: 'nanoid123', wrappedDEK: 'X29fLQ'}],
      remote: {
        vaultUrl: 'http://localhost:3000/vault',
        userId: 'u-1',
        credentialId: 'nanoid123',
        localVersion: 2,
        remoteVersion: 5,
        syncedLocalVersion: 2,
        lastSyncTime: 1723600000,
      },
    })
    const parsed = parseEnvelope(goJson)
    expect(parsed.remote?.lastSyncTime).toBe(1723600000)
    expect(parsed.remote?.lastSyncError).toBe('')
    expect(parsed.credentials[0].wrappedDEK).toBe('X29fLQ')
  })

  test('validates like Go: empty payloads and incomplete remote blocks are rejected', () => {
    expect(() => parseEnvelope('not json')).toThrow('not valid JSON')
    expect(() => parseEnvelope('{}')).toThrow('encrypted data must not be empty')
    expect(() => parseEnvelope(JSON.stringify({encryptedData: 'AQ=='}))).toThrow('wrapped DEK must not be empty')
    expect(() =>
      parseEnvelope(JSON.stringify({encryptedData: 'AQ==', wrappedDEK: 'AQ==', remote: {userId: 'u'}})),
    ).toThrow('Remote vault URL is required')
    expect(() =>
      parseEnvelope(JSON.stringify({encryptedData: 'AQ==', wrappedDEK: 'AQ==', remote: {vaultUrl: 'https://x'}})),
    ).toThrow('Remote vault user ID is required')
    expect(() => parseEnvelope(JSON.stringify({encryptedData: 42, wrappedDEK: 'AQ=='}))).toThrow(
      'must be a base64 string',
    )
  })
})
