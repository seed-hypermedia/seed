---
name: Date-Time
summary: "An instant held as an RFC 3339 string such as `2026-08-26T14:30:00Z`, with `format: date-time` so editors show a date-and-time picker."
schemaDefinition: ipfs://bafyreic3g76lmaoju2gqpwfsbglatomg75g56dgbxs4nhdwm6ka5fn46t4
---
A **date-time** is an instant as an RFC 3339 / ISO 8601 string: `YYYY-MM-DDTHH:MM:SS[.sss]Z`, or the same with a numeric offset (for example `2026-08-26T14:30:00Z`). It refines [string](./string.md) with `format: date-time`, so an editor shows a date-and-time picker, and with a pattern that checks the shape. <!-- id:Us7SMTBC -->

This page describes the **date-time** type, a value type of [Hypermedia Schemas](./schema.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it and create values of this type. <!-- id:TWO5bM7g -->

# Shape <!-- id:3WUWw0DZ -->

Kind: `string`. <!-- id:ZgB4U8NO -->

# See also <!-- id:vGexqQNi -->

- [date](./date.md): a calendar date without a time. <!-- id:kHOef67Q -->
- [timestamp](./timestamp.md): the Unix-millisecond time inside blobs. <!-- id:4Mglu7q6 -->
- [string](./string.md): the underlying kind. <!-- id:10HU0a0l -->
- [Scalar schema](./schema/scalar-schema.md): how `format` and patterns refine a string. <!-- id:B7uD_g9g -->
