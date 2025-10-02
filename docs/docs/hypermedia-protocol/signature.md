# Hypermedia Signature

The signature is the binary data that is resulting when you sign all the fields of a Blob using the [Account Private Key](./accounts.md#private-key), resulting in a Ed25519 Signature.

When used in a blob, is encoded as [Binary Data](./binary-data.md).

## Example Blob Signature

```json
  "sig": {
    "/": {
      "bytes": "3p8E1MnjnssfWAtgWH4D9dUJ6/iyKqOTxsBeOEaceYZAX5Y7E0NKyeqYW6X7qrVwB1woEtQKdH0djZ5eCnKLDw"
    }
  },
```
