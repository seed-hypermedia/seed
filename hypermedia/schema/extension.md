---
name: Extension
summary: A Reference Schema that also carries refinements
---
**Extension**: a [Reference Schema](./include-schema.md) that _also_ carries refinements. <!-- id:IoC_acS3 -->

`{ "type": "hm://…/example/person", "properties": {…} }` <!-- id:vG52Mjgo -->

A subtype: the parent's fields plus the new ones, each a property that says whether it is required. <!-- id:lJDeDmj1 -->

No `extends` keyword — `type` names the parent, and the presence of any other key is what distinguishes an extension from a bare [Reference Schema](./include-schema.md). <!-- id:drnWeK9F -->

Example: [employee](../example/employee.md) extends [person](../example/person.md). <!-- id:-NO5_fFA -->
