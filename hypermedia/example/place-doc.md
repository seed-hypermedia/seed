---
name: Place
summary: A world-builder page type for a place, whose attributes require a kind and may add a founding date, a parent region, and a coordinates object.
schemaDefinition: ipfs://bafyreif2ualrqd5jryfqgwd3yhgocrc7zewjkj3lldtagt2pvbd3qzjzhm
---
A [World Builder](../schema/world-builder.md) page type for a place. Its [attributes](../schema/typed-documents.md) require a `kind` and may carry a `founded` date. A place can nest inside a `region`, which is another place, and link to a coordinates object through an [ipfs:// URL](../ipfs-url.md). That object must conform to [geo](./geo.md). <!-- id:7NTBcQkU -->

This page describes the **example/place-doc** type, one of the [example schemas](../example.md). The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and create values of this type. <!-- id:zeQyDg6y -->

# Shape <!-- id:GLZCFflE -->

A **closed struct** with these fields: <!-- id:Ow0yN6aL -->
  - `kind` _(required)_: [string](../string.md) (one of `city`, `town`, `village`, `fortress`, `ruin`, `wilderness`, `realm`) <!-- id:hAd13nXH -->
  - `founded`: [date](../date.md) <!-- id:8wxCKl6h -->
  - `region`: [hm-url](../hm-url.md) (→ must conform to [example/place-doc](./place-doc.md)) <!-- id:ATWV_Ckx -->
  - `ruler`: [hm-url](../hm-url.md) (→ must conform to [example/faction-doc](./faction-doc.md)) <!-- id:-eI6xxf1 -->
  - `coordinates`: [ipfs-url](../ipfs-url.md) (→ must conform to [example/geo](./geo.md)) <!-- id:nC4HPPfr -->
  - `map`: [ipfs-url](../ipfs-url.md) <!-- id:BAH0mMmh -->

# Depends on <!-- id:SfnIopYv -->

- [hm-url](../hm-url.md) <!-- id:RAGKg-_U -->
- [ipfs-url](../ipfs-url.md) <!-- id:AWDpWFLU -->
- [date](../date.md) <!-- id:-lpQetBo -->
- [string](../string.md) <!-- id:4eJ_Aidm -->

# See also <!-- id:50FuA0nD -->

- [World Builder](../schema/world-builder.md): the demo these types come from. <!-- id:5hWKCEzf -->
- [geo](./geo.md): the coordinates type. <!-- id:bmiALNrc -->
- [faction-doc](./faction-doc.md): the ruler type. <!-- id:lr3L6JWH -->
- [Examples](../example.md): every example, grouped by feature. <!-- id:GXxNYEQ0 -->
