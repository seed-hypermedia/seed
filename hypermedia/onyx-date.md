---
name: Date
summary: "A calendar date as an ISO 8601 string, `YYYY-MM-DD` (e.g. `2026-08-26`). A refinement of string — the value is still plain text on the wire — with `format: date"
schemaDefinition: ipfs://bafyreig5rxdzflcdq6erkcxtcgijyzyezmfipke2k4op2xymelufptoyvi
---
A calendar date as an ISO 8601 string, `YYYY-MM-DD` (e.g. `2026-08-26`). A refinement of string — the value is still plain text on the wire — with `format: date` so an editor renders a date picker rather than a text box, and a pattern so a validator can check the shape without parsing. <!-- id:6bGoK_9Q -->

This document describes the **onyx-date** type — a schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:qoiuf7ZN -->