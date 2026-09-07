---
name: Property
summary: One field of a struct — its value schema, whether a value must include it, and a description of what it is for.
schemaDefinition: ipfs://bafyreiatgjhhs4a6y2haf7yamjxr6p34z63pl45vx5ofathkul2kynibp4
---
A struct lists its fields under `properties`, one property per field name. A property is not itself a schema: it wraps one. `value` is the schema the field's value must match, `required` says whether a value of the struct must include the field, and `description` says what the field is for, which the editors show next to it. <!-- id:kLdsYe2_ -->

Before properties existed, a struct wrote `properties[name]` as the field's schema directly and listed the mandatory ones in a separate `required` list. Schemas published that way are immutable and still read; new schemas are written with properties. <!-- id:4aWAbFCm -->
