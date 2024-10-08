# Raw Permanent Data

In IPLD DAG_CBOR there is a way to encode raw data by specifying an object with `{ "/": { "bytes": <BASE64-URL-Encoded-Data> } }`

This is used to encode raw binary data inside [Hypermedia Permanent Data](./permanent-data.md).

## Example

For example a signature within a structured data block. The raw binary data is first encoded with [base64url (RFC 4648 §5)](https://datatracker.ietf.org/doc/html/rfc4648#section-5) so that it may be safely used in a string.

Then the encoded value is inserted into a `{ "/": { "bytes": ... }}` data structure. So an example signature may look like this (in the JSON representation of the CBOR data):

```
  "sig": {
    "/": {
      "bytes": "5gjnnpeM4WsfjtxZ7bVfojbK8lEG0i3ypypAORjiuLVZXk0t2V/yFsyM6o0PsEp4OVdk2/XKfW7KOthp1FYODA"
    }
  },
```

This approach is also used to encode account public keys ([Account IDs](./accounts.md#account-id)).