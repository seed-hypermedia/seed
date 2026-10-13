import * as keyfile from '@seed-hypermedia/client/keyfile'
import {describe, expect, it} from 'vitest'
import {bearerMatches, homeDocumentOps, seedFromMnemonic, welcomeText} from './enterprise-bootstrap.server'

// The vector the CLI's key-derivation tests and the daemon agree on.
const KNOWN_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const KNOWN_ACCOUNT_ID = 'z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f'

describe('seedFromMnemonic', () => {
  it('derives the account the daemon derives for the same words', () => {
    const seed = seedFromMnemonic(KNOWN_MNEMONIC.split(' '))
    expect(seed).toHaveLength(32)
    expect(keyfile.principalStringFromSeed(seed)).toBe(KNOWN_ACCOUNT_ID)
  })

  it('accepts the phrase as one string and round-trips through a key file', async () => {
    const seed = seedFromMnemonic(KNOWN_MNEMONIC)
    const payload = await keyfile.create({publicKey: KNOWN_ACCOUNT_ID, key: seed})
    const loaded = await keyfile.load(keyfile.stringify(payload))
    expect(loaded.publicKey).toBe(KNOWN_ACCOUNT_ID)
    expect(loaded.seed).toEqual(seed)
  })

  it('changes with the passphrase', () => {
    expect(seedFromMnemonic(KNOWN_MNEMONIC, 'x')).not.toEqual(seedFromMnemonic(KNOWN_MNEMONIC))
  })
})

describe('bearerMatches', () => {
  it('accepts only the exact bearer token', () => {
    expect(bearerMatches('Bearer s3cret', 's3cret')).toBe(true)
    expect(bearerMatches('Bearer s3cret ', 's3cret')).toBe(false)
    expect(bearerMatches('Bearer other', 's3cret')).toBe(false)
    expect(bearerMatches('Bearer s3cre', 's3cret')).toBe(false)
    expect(bearerMatches('s3cret', 's3cret')).toBe(false)
    expect(bearerMatches('Basic s3cret', 's3cret')).toBe(false)
    expect(bearerMatches(null, 's3cret')).toBe(false)
  })
})

describe('homeDocumentOps', () => {
  it('names the space, records its address and adds one welcome paragraph', () => {
    const ops = homeDocumentOps({name: 'Acme', siteUrl: 'https://seed.acme.org'})
    expect(ops[0]).toEqual({
      type: 'SetAttributes',
      attrs: [
        {key: ['name'], value: 'Acme'},
        {key: ['siteUrl'], value: 'https://seed.acme.org'},
      ],
    })
    const replace = ops[1] as {type: string; block: {id: string; type: string; text: string}}
    expect(replace.type).toBe('ReplaceBlock')
    expect(replace.block.type).toBe('Paragraph')
    expect(replace.block.text).toBe(welcomeText('Acme'))
    expect(replace.block.id).toMatch(/^[A-Za-z0-9_-]{8}$/)
    expect(ops[2]).toEqual({type: 'MoveBlocks', parent: '', blocks: [replace.block.id]})
  })
})
