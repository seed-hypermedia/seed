# Concepts

## Account

An account is used to identify a person, an organization, or an independent publisher in the Hypermedia network. Each account has a key pair:

- Private Key - A secret piece of data which is a ED25519 key
- Public Key - The public key that corresponds to the private key.

The public key is generally represented as a string which looks like `z6MkjPVNrNGA6dYEqkspBvfuTnAddw7hrNc5WM6dQDyuKkY3`. This is a multiformat string, and we conventionally use base58 encoding (which is why each account ID string starts with a `z`)

Each account may be defined by a secret 12-word mnemonic which may be used recover the key pair. This is a BIP-39 series of words which may be converted into a binary data "seed".

This seed is used as an input to a key derivation function for the ed25519 key, which uses the following derivation path: `<todo>`. This can be computed using a library such as `<example1>` or `<example2>`.

## Document

A document is a cohesive piece of content which contains metadata and a hierarchal list of [blocks](./document-blocks.md).

In the [permanent data](./permanent-data.md), the document is represented as a series of [document operations](./document-operations.md) within Changes. After interpreting these operations, the you may arrive at the [state of a document](./document-state.md).

## Home Document

The Document with an empty path, which may be used as the profile or "home page" for an account.

The Home Document is addressed with a Hypermedia URL of `hm://ACCOUNT_ID`, using the [Account ID](./accounts.md#account-id)

## Owner

The owner is the account who ultimately controls the document. If the Document URL is `hm://BOB_ACCOUNT_ID/my-document`, the owner is Bob.

## Change

A [Document Change](./blob-change.md) is a blob of data that describes how the content and metadata of a Document is changing.

## Version

The list of leaf Changes which represent a specific version of a document.

The current Version is defined by the most recent set of Changes that has been designated by valid Refs.

A Version may be specified in any [Hypermedia URL](./hypermedia-url.md#version).

## Capability

A capability gives one account additional priveliges in the context of another account. For example, Alice may have a document called "Best Books", which she wants to let Bob edit. So Alice may create a capability which roughly looks like this:

```
{
    "@type": "Capability",
    "": ""
}
```

## Contributor

An Account who has access to contribute to the Document. When they start signing Changes for this Document, they will become an Author.

## Author

An Account who has created a Change in the

## Refs

The pointer to the current Version of a document. Signed by the Document Owner

Saved as [Ref Blobs](./blob-ref.md) and distributed through [IPFS](./ipfs.md) and

## Capability

## [Hypermedia URL](./hypermedia-url.md)

The URL format for Hypermedia links. These links generally follow the form `hm://ACCOUNT_ID/PATH?PARAMS`. The params include metadata for referencing
