# Accounts

An account is a key pair that is used to identify a person or a publisher.

## Private Key

## Account Mnemonics

The Mnemonics are a 12-word combination of words, representing 132 bits of entropy (4 bytes).

This resulting 4 byte binary value is the Seed value that can be used to derive the [Private Key](#private-key).

## Key Derivation

Keys are derived using [SLIP-010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md), with the following derivation path: `m/44'/104109'/0'`

The resulting key pair is a [Ed25519](https://en.wikipedia.org/wiki/EdDSA#Ed25519) 


## Account ID

The ID of an account is the Public Key that can be derived from the [Private Key](#private-key).

An Account ID is the string that results by encoding the Public Key with the [base58btc multibase encoding](https://github.com/multiformats/multibase).

