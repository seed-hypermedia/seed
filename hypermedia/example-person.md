---
name: "Example: Person"
summary: A person with a name, age, active flag, home address, and nicknames.
schemaDefinition: ipfs://bafyreiecjmj5fpn6rshbkukj3mij4rr2mysalr3k3ev2dyketnufh4pqzq
---
This document describes the **example-person** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:kz18rr1h -->

# Shape <!-- id:nO4ZbXuU -->

A **closed struct** with these fields: <!-- id:51ZzX9mF -->
  - `name` _(required)_ — [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:YKA6rXKs -->
  - `age` — [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:6Bn2OXOQ -->
  - `active` — [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:IP0tRSYe -->
  - `home` — [example-address](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-address) <!-- id:unQF92CR -->
  - `nicknames` — list of [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:frbGcNPJ -->

# Depends on <!-- id:m3wQHzN9 -->

- [example-address](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-address) <!-- id:I8YpzqPS -->
- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:JFRlonA9 -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:ahaLhNaq -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:IXcpwC8q -->
