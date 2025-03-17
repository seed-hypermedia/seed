export async function preparePublicKey(publicKey: CryptoKey) {
  // Export raw key first
  const raw = await crypto.subtle.exportKey('raw', publicKey)
  const bytes = new Uint8Array(raw)

  // Raw format is 65 bytes: 0x04 + x (32) + y (32)
  const x = bytes.slice(1, 33)
  const y = bytes.slice(33)

  // Check if y is odd
  const prefix = y[31] & 1 ? 0x03 : 0x02

  const outputKeyValue = new Uint8Array([
    // varint prefix for 0x1200
    128,
    36,
    prefix,
    ...x,
  ])
  return outputKeyValue
}
