# Capability Blob

The Capability Blob is created by accounts to grant priveliges for another account to access or control an additional document (or tree of documents).

## Blob Map Field

- `@type: 'Capability'`
- `issuer` - [Raw Account ID](./raw-account-id.md) of the Account who is granting the capability
- `delegate` - [Raw Account ID](./raw-account-id.md) of the Account who is receiving the capability
- `space` - [Raw Account ID](./raw-account-id.md) of the Account that contains the document
- `path` - String of the path which identifies this document
- `role` - String to specify
- `ts` - [Timestamp](./timestamp.md) when this Capability was created
- `noRecursive` - Boolean. `True` means the capability only applies to this document. `False` allows this capability to apply to all children paths.
- `sig` - [Hypermedia Signature](./signature.md) of the other fields, signed by the `issuer`

## Issuer

The Issuer Account is the Account who is giving the role to the Delegate Account.

## Delegate

The Delegate Account is receiving additional capabilities for the Document, according to the Role.

## Document Address

The `space` and `path` of the document that the capability is granting access to.

Often, the `space` may be identical to the `issuer`, when somebody grants priveliges to their own document.

## Role

String which describes the role that should be granted to the delegate (recipient) Account.

## Recursion