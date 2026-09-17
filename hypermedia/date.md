---
name: Date
summary: "A calendar date held as an ISO 8601 `YYYY-MM-DD` string, with `format: date` so editors show a date picker and validators can check the shape."
schemaDefinition: ipfs://bafyreias4fhv7ebvzlrfqdc734ixwombrmq7u6xht3s4e4m35cqsjzpbci
---
A calendar date as an ISO 8601 string, `YYYY-MM-DD` (e.g. `2026-08-26`). A refinement of string — the value is still plain text on the wire — with `format: date` so an editor renders a date picker rather than a text box, and a pattern so a validator can check the shape without parsing. <!-- id:6bGoK_9Q -->

This page describes the **date** type — a value type of Hypermedia Schemas. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qoiuf7ZN -->

# Shape <!-- id:--4HbeAP -->

Kind: `string`. <!-- id:TLWNfW3n -->
