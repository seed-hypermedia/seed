---
name: Query sort
summary: One sort term for a Query block's results, optionally reversed.
schemaDefinition: ipfs://bafyreihdp4gko4y4fkeb2cwxpv7ev3tnbuvgkuzeiwe7hvh64ma2upbaqm
---
This document describes the **hypermedia-query-sort** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:eaWXyOUU -->

# Shape <!-- id:P0EJDwNB -->

A **closed struct** with these fields: <!-- id:9JJXnFXo -->
  - `reverse` — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:d_agsTi8 -->
  - `term` _(required)_ — `string` enum: `Path` `Title` `CreateTime` `UpdateTime` `DisplayTime` `ActivityTime` <!-- id:GeGLwkRQ -->

# Depends on <!-- id:qCmEO3j- -->

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:ycEmiVRJ -->
