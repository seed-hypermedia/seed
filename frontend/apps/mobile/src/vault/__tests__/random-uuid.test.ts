/**
 * The Hermes `crypto.randomUUID` polyfill. Hermes ships none, and the shared agents models call it
 * on the two paths a user notices immediately: creating a session (`clientRequestId`) and sending a
 * message (the optimistic row's `clientMessageId`, which the durable echo replaces by identity).
 *
 * jsdom provides its own, so the polyfill's own branch never installs here — this exercises the
 * implementation directly against the RFC's shape and uniqueness requirements.
 */

const HEX = '[0-9a-f]'
const UUID_V4 = new RegExp(`^${HEX}{8}-${HEX}{4}-4${HEX}{3}-[89ab]${HEX}{3}-${HEX}{12}$`)

/** The polyfill body from src/vault/platform.ts, over an injectable RNG. */
function randomUUID(getRandomValues: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(16)
  getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'))
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  )
}

const realRandom = (bytes: Uint8Array) => crypto.getRandomValues(bytes)

describe('crypto.randomUUID polyfill', () => {
  it('produces a well-formed v4 UUID', () => {
    expect(randomUUID(realRandom)).toMatch(UUID_V4)
  })

  it('stamps the version and variant bits even when the RNG returns all zeros', () => {
    const uuid = randomUUID((bytes) => bytes.fill(0x00))
    expect(uuid).toBe('00000000-0000-4000-8000-000000000000')
    expect(uuid).toMatch(UUID_V4)
  })

  it('stamps the version and variant bits even when the RNG returns all ones', () => {
    const uuid = randomUUID((bytes) => bytes.fill(0xff))
    expect(uuid).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(uuid).toMatch(UUID_V4)
  })

  it('zero-pads bytes below 0x10 instead of shortening the string', () => {
    // A naive toString(16) drops the leading zero and yields a 35-character id — which would
    // silently collide across messages rather than fail loudly.
    const uuid = randomUUID((bytes) => bytes.fill(0x01))
    expect(uuid).toHaveLength(36)
    expect(uuid).toMatch(UUID_V4)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({length: 500}, () => randomUUID(realRandom)))
    expect(seen.size).toBe(500)
  })
})
