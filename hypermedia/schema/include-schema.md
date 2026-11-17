---
name: Include schema
summary: The variant for a reference, which is a bare include or, when it carries refinements, an extension.
---
An **include** is a schema that names another schema and adds nothing: `{ "type": "hm://…" }`. The node becomes exactly the schema it names. The name is a URL. Most often it is an [`hm://` URL](../protocol/urls.md). It can also be `ipfs://<cid>`, which names one exact schema by its [CID](../cid.md). <!-- id:NgjaircK -->

Adding `properties`, `values`, `items` or `target` makes the node refine the schema it names instead. That is an [extension](./extension.md). `args` is different: it fills in the parameters of a [generic](./generic.md). [References and naming](./references.md) covers includes, links and extensions.

This page defines the **schema/include-schema** type, one [variant](./variant.md) of the [meta-schema](../schema.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](../metadata.md). So the app can show the schema and create values of this type. [Typed documents](./typed-documents.md) explains how that works. <!-- id:HXN4g1ct -->

# See also <!-- id:BVzFQBbC -->

- [References and naming](./references.md): include, typed link and extension, and why references are names. <!-- id:rBMw5f8h -->
- [Extension](./extension.md): an include that also carries refinements. <!-- id:n-oYFjoy -->
- [Link schema](./link-schema.md): a pointer to a separate object, where an include copies a shape. <!-- id:zQ995yat -->
- [`hm://` URL](../hm-url.md): how a reference names its schema. <!-- id:BsE9Xede -->
- [Variant](./variant.md): the members of the meta-schema union. <!-- id:Yel3N5KH -->
