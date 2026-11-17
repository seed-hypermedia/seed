---
name: Date-Time
summary: "An instant held as an RFC 3339 string such as `2026-08-26T14:30:00Z`, with `format: date-time` so editors show a date-and-time picker."
---
A **date-time** is one exact moment: a date and a time of day, written as text. The form is `YYYY-MM-DDTHH:MM:SS[.sss]Z` (RFC 3339 / ISO 8601), or the same with a numeric offset in place of `Z`. For example, `2026-08-26T14:30:00Z`. <!-- id:Us7SMTBC -->

A date-time refines [string](./string.md), so the stored value is still plain text. `format: date-time` makes an editor show a date-and-time picker. A `pattern` checks the shape.

This page defines the **date-time** type, a value type of [Hypermedia Schemas](./schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type. <!-- id:TWO5bM7g -->

# See also <!-- id:vGexqQNi -->

- [date](./date.md): a calendar date without a time. <!-- id:kHOef67Q -->
- [timestamp](./timestamp.md): the Unix-millisecond time inside [blobs](./protocol/blobs.md). <!-- id:4Mglu7q6 -->
- [string](./string.md): the underlying kind. <!-- id:10HU0a0l -->
- [Scalar schema](./schema/scalar-schema.md): how `format` and patterns refine a string. <!-- id:B7uD_g9g -->
- [Catalogue of types](./schema/types.md): every type in the library.
