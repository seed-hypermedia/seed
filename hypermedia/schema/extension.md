---
name: Extension
summary: A Reference Schema that also carries refinements.
---
**Extension**: a [Reference Schema](./include-schema.md) that _also_ carries refinements. <!-- id:IoC_acS3 -->

`{ "type": "hm://…/example/person", "properties": {…} }` <!-- id:vG52Mjgo -->

An extension is a subtype. It has the parent's fields plus the new ones, and each new field is a [property](./property.md) that says whether it is required. <!-- id:lJDeDmj1 -->

There is no `extends` keyword. `type` names the parent. Any other key on the node is what makes it an extension instead of a bare [Reference Schema](./include-schema.md). <!-- id:drnWeK9F -->

Example: [employee](../example/employee.md) extends [person](../example/person.md). <!-- id:-NO5_fFA -->

# See also <!-- id:d6mFleaG -->

- [References and naming](./references.md): include, link and extension side by side. <!-- id:YKGXsf7b -->
- [Include schema](./include-schema.md): the variant an extension belongs to. <!-- id:5FToMJqL -->
- [Property](./property.md): the fields an extension adds. <!-- id:C1W1JH50 -->
- [Generic](./generic.md): the other way to reuse a schema. <!-- id:uwPSMwR9 -->
