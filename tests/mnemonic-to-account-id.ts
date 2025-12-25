#!/usr/bin/env npx tsx
/**
 * Simple CLI to convert a BIP39 mnemonic to a Seed account ID
 * Usage: npx tsx tests/mnemonic-to-account-id.ts "your mnemonic words here"
 */

import {deriveAccountIdFromMnemonic} from './key-derivation'

const mnemonic = process.argv[2]

if (!mnemonic) {
  console.error('Usage: npx tsx tests/mnemonic-to-account-id.ts "your mnemonic words here"')
  console.error('Example: npx tsx tests/mnemonic-to-account-id.ts "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"')
  process.exit(1)
}

const accountId = deriveAccountIdFromMnemonic(mnemonic)
console.log(accountId)
