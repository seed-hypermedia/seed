---
name: "Date-time"
summary: "An instant as an RFC 3339 / ISO 8601 string, `YYYY-MM-DDTHH:MM:SS[.sss]Z` or with a numeric offset (e.g. `2026-08-26T14:30:00Z`). A refinement of string with `f"
---

# Date-time

An instant as an RFC 3339 / ISO 8601 string, `YYYY-MM-DDTHH:MM:SS[.sss]Z` or with a numeric offset (e.g. `2026-08-26T14:30:00Z`). A refinement of string with `format: date-time` so an editor renders a date-and-time picker, and a pattern that checks the shape.


This document describes the **onyx-date-time** type — a schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

Kind: `string`.
