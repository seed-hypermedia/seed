---
name: Page Input
summary: A page takes typed input from its URL, declared by the struct schema its inputSchema names, and this closed, empty struct is the default for a page that takes none.
---
This closed, empty struct is the input contract for a [custom HTML page](./page.md) that accepts no parameters. Pages with inputs publish their own HM struct schema and reference it in `inputSchema`. <!-- id:Gk-v2ivJ -->

This page is also the home of how page input works: the schema, the URL form, the calls a page uses, and the form a viewer uses.

# The input schema

The input schema is an HM struct: one property for each input field. Publish the schema blob and optionally bind it to a readable type resource through `schemaDefinition`. Other tools can discover the contract by reading the page's `inputSchema` reference. A page without inputs uses this empty struct. <!-- id:pIqCLa86 -->

Every page declares `inputSchema`, a reference to a published HM struct schema. The default is this empty page input; pages with prefills, filters or navigation state publish their own contract before the HTML. <!-- id:f7Le6ETh -->

# Input in the URL

Input lives in the page URL. Each field `name` becomes the query parameter `p.name`, whose value is JSON encoded and then URL encoded. For example `?p.prompt=%22Hello%22&p.count=3`. Seed's own version and panel parameters are separate. Input is public URL state: do not place secrets in it. <!-- id:BfRaf7SO -->

# Reading and changing input

The SDK provides `seed.input.get()`, `seed.input.push(values)`, `seed.input.replace(values)` and `seed.input.onChange(listener)`. Push adds a history entry; replace updates the current one. Both take the complete input object and validate it against the declared schema before changing the URL. Browser and desktop Back/Forward restore the input without restarting the page. Invalid incoming URLs are reported as input errors so the page can show a correction UI. <!-- id:Tirgg5Rw -->

`seed.input.get()` resolves to `{values, schema, errors}`. The page remains mounted across input changes, so `onChange` is where it reacts to them. The other calls are in [the page SDK](./build/page-sdk.md).

# The Page parameters form

Open **Page parameters** from the page’s breadcrumb options menu to edit URL input in a schema-derived form. Seed renders typed fields, optional values and nested structures, and validates changes before **Apply** adds a history entry. **Cancel** leaves the URL unchanged; **Reset** clears optional fields and restores starting values for required fields. Back/Forward updates both the page and an open parameter form without restarting the page.

# See also

- [Page](./page.md), the type this schema serves.
- [The page SDK](./build/page-sdk.md) for the rest of `window.seed`.
- [Schemas](./schema.md) for HM structs.
