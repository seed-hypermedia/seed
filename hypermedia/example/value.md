---
name: "Example: Value"
summary: "A primitive value: string, integer, boolean, or null."
schemaDefinition: ipfs://bafyreieg4ddcrqezij6pymoqtm7tex6i3c6nsl7qkhmj5trfboz534k4qi
---
A primitive value: a [union](../schema/anyof.md) of [string](../string.md), [integer](../integer.md), [boolean](../boolean.md) or [null](../null.md). <!-- id:E9afMyGb -->

This page describes the **example/value** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:U1Ak7_KO -->

# Shape <!-- id:r2x_xElQ -->

A **union**. A value matches one of these variants: <!-- id:CaQ1qtr3 -->
  - [string](../string.md) <!-- id:R51R892c -->
  - [integer](../integer.md) <!-- id:0z5JkiP8 -->
  - [boolean](../boolean.md) <!-- id:2WXDUcve -->
  - [null](../null.md) <!-- id:_tAHmUYD -->

# Depends on <!-- id:5rTldh8q -->

- [boolean](../boolean.md) <!-- id:Bc29oMOs -->
- [integer](../integer.md) <!-- id:YhbdJAMR -->
- [null](../null.md) <!-- id:VkEPDTco -->
- [string](../string.md) <!-- id:BMopbHvt -->

# See also <!-- id:X5iiuc-H -->

- [json](./json.md): the recursive version. <!-- id:sqabJ2xc -->
- [status](./status.md): a union of literals. <!-- id:TXspdnAc -->
- [Union](../schema/anyof.md): how `anyOf` works. <!-- id:3FbVzYCt -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:--JN0hRJ -->
