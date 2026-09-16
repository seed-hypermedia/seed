---
name: Property
summary: One field of a struct — its value schema, whether a value must include it, and a description of what it is for.
schemaDefinition: ipfs://bafyreiddimhjlsf7ba6idhzdt6h5bgna77merrs5msg4vscsauuc362u3q
---
A struct lists its fields under `properties`, one property per field name. A property is not itself a schema: it wraps one. `value` is the schema the field's value must match, `required` says whether a value of the struct must include the field, and `description` says what the field is for, which the editors show next to it. <!-- id:kLdsYe2_ -->
