import {webcrypto} from 'crypto'

/**
 * Decompresses a compressed P-256 public key
 * @param compressedKey - Compressed public key in the format: [prefix (0x02 or 0x03), x-coordinate (32 bytes)]
 * @returns Uncompressed public key as CryptoKey
 */
async function decompressPublicKey(
  compressedKey: Uint8Array,
): Promise<CryptoKey> {
  // Remove the varint prefix (128, 36) to get just the compressed key
  const actualCompressedKey = compressedKey.slice(2)

  // First byte is the prefix (0x02 or 0x03) indicating if y is even or odd
  const prefix = actualCompressedKey[0]
  const x = actualCompressedKey.slice(1)

  // Convert x coordinate to big integer
  const xBigInt = BigInt('0x' + Buffer.from(x).toString('hex'))

  // P-256 curve parameters
  const p = BigInt(
    '0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF',
  )
  const a = BigInt(-3)
  const b = BigInt(
    '0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B',
  )

  // Calculate y² = x³ + ax + b
  const ySquared = (xBigInt * xBigInt * xBigInt + a * xBigInt + b) % p

  // Calculate y using square root
  let y = modularSquareRoot(ySquared, p)

  // If prefix doesn't match y's oddness, use the other root
  const yIsOdd = (y & 1n) === 1n
  if ((prefix === 0x03 && !yIsOdd) || (prefix === 0x02 && yIsOdd)) {
    y = p - y
  }

  // Convert to uncompressed format (0x04 || x || y)
  const uncompressedKey = new Uint8Array(65)
  uncompressedKey[0] = 0x04
  uncompressedKey.set(x, 1)
  const yBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    yBytes[31 - i] = Number((y >> BigInt(i * 8)) & 0xffn)
  }
  uncompressedKey.set(yBytes, 33)

  // Import as CryptoKey
  return webcrypto.subtle.importKey(
    'raw',
    uncompressedKey,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['verify'],
  )
}

/**
 * Calculate modular square root using Tonelli-Shanks algorithm
 */
function modularSquareRoot(n: bigint, p: bigint): bigint {
  if (n === 0n) return 0n

  // Legendre symbol test
  const ls = legendreSymbol(n, p)
  if (ls === -1) throw new Error('No square root exists')

  let q = p - 1n
  let s = 0n
  while (q % 2n === 0n) {
    q /= 2n
    s++
  }

  if (s === 1n) {
    const r = modPow(n, (p + 1n) / 4n, p)
    return r
  }

  let z = 2n
  while (legendreSymbol(z, p) !== -1) {
    z++
  }

  let c = modPow(z, q, p)
  let r = modPow(n, (q + 1n) / 2n, p)
  let t = modPow(n, q, p)
  let m = s

  while (t !== 1n) {
    let i = 0n
    let temp = t
    while (temp !== 1n && i < m) {
      temp = (temp * temp) % p
      i++
    }

    if (i === 0n) return r

    const b = modPow(c, modPow(2n, m - i - 1n, p - 1n), p)
    r = (r * b) % p
    c = (b * b) % p
    t = (t * c) % p
    m = i
  }

  return r
}

function legendreSymbol(a: bigint, p: bigint): number {
  const ls = modPow(a, (p - 1n) / 2n, p)
  if (ls === p - 1n) return -1
  return Number(ls)
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n

  let result = 1n
  base = base % modulus

  while (exponent > 0n) {
    if (exponent % 2n === 1n) {
      result = (result * base) % modulus
    }
    base = (base * base) % modulus
    exponent = exponent / 2n
  }

  return result
}

/**
 * Validates a signature against a compressed public key
 * @param compressedPublicKey - Compressed public key with varint prefix
 * @param signature - The signature to verify
 * @param data - The original data that was signed
 * @returns Promise<boolean> - Whether the signature is valid
 */
export async function validateSignature(
  compressedPublicKey: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  try {
    // Check if it's an Ed25519 key (first byte is 0xED)
    if (compressedPublicKey[0] === 0xed) {
      // For Ed25519, we need exactly 32 bytes after the prefix
      const keyData = compressedPublicKey.slice(2, 34)
      if (keyData.length !== 32) {
        throw new Error(`Invalid Ed25519 key length: ${keyData.length}`)
      }
      const rawKey = new Uint8Array(32)
      rawKey.set(keyData)
      const publicKey = await webcrypto.subtle.importKey(
        'raw',
        rawKey,
        {
          name: 'Ed25519',
        },
        true,
        ['verify'],
      )
      return await webcrypto.subtle.verify(
        {
          name: 'Ed25519',
        },
        publicKey,
        signature,
        data,
      )
    }

    // P-256 key handling
    const publicKey = await decompressPublicKey(compressedPublicKey)
    const isValid = await webcrypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: {name: 'SHA-256'},
      },
      publicKey,
      signature,
      data,
    )
    return isValid
  } catch (error) {
    console.error('Signature validation error:', error)
    return false
  }
}
