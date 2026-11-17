---
name: Page Input
summary: A page takes typed input from its URL, declared by the struct schema its inputSchema names, and this closed, empty struct is the default for a page that takes none.
---
A [page](./page.md) takes its input from its URL. The page declares the fields in a schema, and each field becomes a `p.<name>` query parameter. For example, a page with a `count` field opens with `?p.count=3`. <!-- id:Gk-v2ivJ -->

This page explains the schema, the URL form, the calls a page uses and the form a viewer uses. This page is also itself a schema: the closed, empty [struct](./struct.md) that a page with no input points at.

# The input schema

The input schema is an [HM struct](./schema/struct-schema.md), with one property for each input field. Publish the schema [blob](./protocol/blobs.md). You can also bind it to a readable type [document](./protocol/documents.md) through `schemaDefinition`. Other programs can find the contract by reading the page's `inputSchema`. <!-- id:pIqCLa86 -->

Every page declares `inputSchema`, a reference to a published HM struct schema. A page with no input points at this empty page input. A page with prefills, filters or navigation state publishes its own schema before the HTML. <!-- id:f7Le6ETh -->

# Input in the URL

Input lives in the page URL. Each field `name` becomes the query parameter `p.name`. Its value is JSON encoded and then URL encoded. For example `?p.prompt=%22Hello%22&p.count=3`. Seed's own version and panel parameters are separate. Anyone who sees the URL sees the input, so do not put secrets in it. <!-- id:BfRaf7SO -->

# Reading and changing input

[The page SDK](./build/page-sdk.md) provides `seed.input.get()`, `seed.input.push(values)`, `seed.input.replace(values)` and `seed.input.onChange(listener)`. Push adds a history entry. Replace updates the current one. Both take the complete input object and check it against the declared schema before they change the URL. Back and Forward, in the browser and on the desktop, restore the input without restarting the page. If an incoming URL is invalid, the page gets input errors, so it can show the viewer how to correct it. <!-- id:Tirgg5Rw -->

`seed.input.get()` resolves to `{values, schema, errors}`. The page keeps running when the input changes, so `onChange` is where it reacts. The other calls are in [the page SDK](./build/page-sdk.md).

# The Page parameters form

A viewer can edit the input in a form. Open **Page parameters** from the options menu in the page's breadcrumbs. Seed builds the form from the schema, with typed fields, optional values and nested structures.

- **Apply** checks the changes, then adds a history entry.
- **Cancel** leaves the URL unchanged.
- **Reset** clears optional fields and restores the starting values of required fields.

Back and Forward update both the page and an open form without restarting the page.

# See also

- [Page](./page.md), the type this schema serves.
- [The page SDK](./build/page-sdk.md) for the rest of `window.seed`.
- [Schemas](./schema.md) for HM structs.
