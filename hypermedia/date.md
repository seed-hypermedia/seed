---
name: Date
summary: "A calendar date held as an ISO 8601 `YYYY-MM-DD` string, with `format: date` so editors show a date picker and validators can check the shape."
---
A **date** is a calendar day, written as text in the form `YYYY-MM-DD` (ISO 8601). For example, `2026-08-26`. It has no time of day. <!-- id:6bGoK_9Q -->

A date refines [string](./string.md), so the stored value is still plain text. The schema adds two things. `format: date` makes an editor show a date picker instead of a text box. A `pattern` lets a validator check the shape without parsing the date.

This page defines the **date** type, a value type of [Hypermedia Schemas](./schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show the schema and create values of this type. <!-- id:qoiuf7ZN -->

# See also <!-- id:1c9dHxCh -->

- [date-time](./date-time.md): an instant with a time of day. <!-- id:p-2hO2_r -->
- [timestamp](./timestamp.md): the Unix-millisecond time inside [blobs](./protocol/blobs.md). <!-- id:W2TF9w_h -->
- [string](./string.md): the underlying kind. <!-- id:GMcynSvc -->
- [Scalar schema](./schema/scalar-schema.md): how `format` and patterns refine a string. <!-- id:05vrxIPm -->
- [Catalogue of types](./schema/types.md): every type in the library.
