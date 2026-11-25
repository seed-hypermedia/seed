import * as blobs from '@shm/shared/blobs'
import {describe, expect, test} from 'bun:test'
import * as mnemonic from './account-mnemonic'

const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('account mnemonic import', () => {
  test.each([
    [words, 'z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f'],
    [
      'parrot midnight lion defense ski senior trouble slice chase spot history awkward',
      'z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8',
    ],
  ])('matches existing Seed account derivation for %s', async (phrase, expected) => {
    const seed = await mnemonic.deriveAccountSeed(phrase)
    expect(blobs.principalToString(blobs.nobleKeyPairFromSeed(seed).principal)).toBe(expected)
  })

  test('accepts pasted uppercase words separated by whitespace or commas', async () => {
    expect(await mnemonic.deriveAccountSeed(`  ${words.toUpperCase().replaceAll(' ', ',\n ')}  `)).toEqual(
      await mnemonic.deriveAccountSeed(words),
    )
  })

  test.each(['', 'not a recovery phrase', Array(12).fill('abandon').join(' ')])(
    'rejects invalid words or checksum: %s',
    async (phrase) => {
      await expect(mnemonic.deriveAccountSeed(phrase)).rejects.toThrow('Invalid account recovery phrase')
    },
  )

  test('supports a 24-word account phrase', async () => {
    expect(await mnemonic.deriveAccountSeed(`${Array(23).fill('abandon').join(' ')} art`)).toHaveLength(32)
  })
})

// Independently calculated with Python hashlib.pbkdf2_hmac and hmac.digest.
test.each([
  ['café', 'd2aafe77bf59c2c34db81da0b84beba0ee44b12a5965d6eaf5fd9eb2d0dad605'],
  ['TREZOR', 'abef301b51c4dd771b6fced2715ce3c306fff99fcca847aa8be4b8ad42842486'],
  [' secret ', 'a3c56832d2b3976001e050c7e9ab0888fee4db25b1c9b1dfc9207d7b8ff9ff75'],
])('matches the passphrase vector without trimming %s', async (passphrase, expected) => {
  expect(Buffer.from(await mnemonic.deriveAccountSeed(words, passphrase)).toString('hex')).toBe(expected)
})
