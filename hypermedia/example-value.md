---
name: "Example: Value"
summary: "A primitive value: string, integer, boolean, or null."
schemaDefinition: ipfs://bafyreigihbrqocdwo5tvwwtz5sa5syz6zgcmxvegd3xdtlfhxh7ucab24m
---
This document describes the **example-value** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:U1Ak7_KO -->

# Shape <!-- id:r2x_xElQ -->

A **union** — a value matches one of these variants: <!-- id:CaQ1qtr3 -->
  - [string](./hypermedia-string.md) <!-- id:R51R892c -->
  - [integer](./hypermedia-integer.md) <!-- id:0z5JkiP8 -->
  - [boolean](./hypermedia-boolean.md) <!-- id:2WXDUcve -->
  - [null](./hypermedia-null.md) <!-- id:_tAHmUYD -->

# Depends on <!-- id:5rTldh8q -->

- [boolean](./hypermedia-boolean.md) <!-- id:Bc29oMOs -->
- [integer](./hypermedia-integer.md) <!-- id:YhbdJAMR -->
- [null](./hypermedia-null.md) <!-- id:VkEPDTco -->
- [string](./hypermedia-string.md) <!-- id:BMopbHvt -->
