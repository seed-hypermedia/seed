---
name: Date
summary: "A calendar date held as an ISO 8601 `YYYY-MM-DD` string, with `format: date` so editors show a date picker and validators can check the shape."
schemaDefinition: ipfs://bafyreias4fhv7ebvzlrfqdc734ixwombrmq7u6xht3s4e4m35cqsjzpbci
---
A **date** is a calendar date as an ISO 8601 string, `YYYY-MM-DD` (for example `2026-08-26`). It refines [string](./string.md), so the value is still plain text on the wire. `format: date` makes an editor show a date picker instead of a text box, and a pattern lets a validator check the shape without parsing. <!-- id:6bGoK_9Q -->

This page describes the **date** type, a value type of [Hypermedia Schemas](./schema.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:qoiuf7ZN -->

# Shape <!-- id:--4HbeAP -->

Kind: `string`. <!-- id:TLWNfW3n -->

# See also

- [date-time](./date-time.md): an instant with a time of day.
- [timestamp](./timestamp.md): the Unix-millisecond time inside blobs.
- [string](./string.md): the underlying kind.
- [Scalar schema](./schema/scalar-schema.md): how `format` and patterns refine a string.
