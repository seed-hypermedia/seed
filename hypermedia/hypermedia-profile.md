---
name: Profile
summary: "A snapshot describing an account: display name, avatar, and description — or an alias redirecting to another key."
schemaDefinition: ipfs://bafyreigklju7lwrrk4d23sx23ynb7nzdx7qd6mvnmvsgsu4pflewrmabbu
---
This document describes the **hypermedia-profile** type — a Hypermedia Network blob schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:cZeSgsmH -->

# Shape <!-- id:_CVm1QUz -->
**Extends** [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) with these added fields: <!-- id:1UgKs7D_ -->
  - `type` — `string` enum: `Profile` <!-- id:N3u2-MXs -->
  - `alias` — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:4GNS3Kp_ -->
  - `name` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:3XSac4Ad -->
  - `avatar` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:3R4vEqDy -->
  - `description` — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:ITRFxA9m -->
  - `account` — [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:6nYH0t9c -->

# Depends on <!-- id:yqwCrza_ -->
- [hypermedia-blob](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-blob) <!-- id:5nAT-Ca0 -->
- [hypermedia-principal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-principal) <!-- id:XELjiLjq -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:U1O1ayoB -->