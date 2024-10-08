# Concepts

## Account

An account is used to identify a person, an organization, or an independent publisher in the Hypermedia network. Each account has a key pair:

- Private Key - A secret piece of data which is a ED25519 key
- Public Key - The public key that corresponds to the private key.

The public key is generally represented as a string which looks like `z6MkjPVNrNGA6dYEqkspBvfuTnAddw7hrNc5WM6dQDyuKkY3`. This is a multiformat string, and we conventionally use base58 encoding (which is why each account ID string starts with a `z`)

Each account may be defined by a secret 12-word mnemonic which may be used recover the key pair. This is a BIP-39 series of words which may be converted into a binary data "seed".

This seed is used as an input to a key derivation function for the ed25519 key, which uses the following derivation path: `<todo>`. This can be computed using a library such as `<example1>` or `<example2>`.

## Document

A document is a cohesive piece of content which contains metadata and a hierarchal list of [blocks](./document-blocks).

In the [permanent data](./permanent-data), the document is represented as a series of [document operations](./document-operations) within Changes. After interpreting these operations, the you may arrive at the [state of a document](./document-state).

## Home Document

## Changes

## Capability

A capability is a blob of data that gives one account additional priveliges in the context of another account. For example, Alice may have a document called "Best Books", which she wants to let Bob edit. So Alice may create a capability which roughly looks like this:

```
{
    "@type": "Capability",
    "": ""
}
```

## Refs

## Capability

## [Hypermedia URL](./hypermedia-url)

The URL format for Hypermedia links. These links are prefixed with `hm://`.