---
name: "Example: JSON value"
summary: "A recursive JSON value: null, boolean, number, string, list, or map. References itself."
schemaDefinition: ipfs://bafyreibhicrqjqk77m5rdoto2fc2lvm4vqy5ec5ppgtrjibrzcmu6gvkum
---
This document describes the **example-json** type — an example schema. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type. <!-- id:3z3l-Qim -->

# Shape <!-- id:MpnY_Cdp -->

A **union** — a value matches one of these variants: <!-- id:LeYxSEKh -->
  - [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:dlUEmbPh -->
  - [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:WAJK2blO -->
  - [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:ilz7JEhq -->
  - [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:9h0fuk1V -->
  - [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:HsFuiAVe -->
  - list of [example-json](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-json) <!-- id:LjwzOynV -->
  - map ⟨ \* : [example-json](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/example-json) ⟩ <!-- id:EvT76FYf -->

# Depends on <!-- id:-Dr_wY1e -->

- [boolean](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/boolean) <!-- id:-g3SgUVF -->
- [float](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/float) <!-- id:irteeJM_ -->
- [integer](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/integer) <!-- id:7Jtvm8Zo -->
- [null](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/null) <!-- id:M_y7MmNP -->
- [string](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/string) <!-- id:f_KyPTCR -->
