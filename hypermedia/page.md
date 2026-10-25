---
name: Custom HTML Page
summary: A resource type for a sandboxed HTML page with schema-defined URL input.
---
A **custom HTML page** is a resource with `type: hm://hyper.media/page`. Its `html` attribute points to an IPFS folder containing `index.html`; its `inputSchema` points to a published [Hypermedia schema](./schema.md). This is a page, rather than a larger application. <!-- id:m5PngYkS -->

The input schema is an HM struct: one property for each input field. Publish the schema blob and optionally bind it to a readable type resource through `schemaDefinition`. Other tools can discover the contract by reading the page's `inputSchema` reference. A page without inputs uses [page-input](./page-input.md). <!-- id:pIqCLa86 -->

Input lives in the page URL. Each field `name` becomes the query parameter `p.name`, whose value is JSON encoded and then URL encoded. For example `?p.prompt=%22Hello%22&p.count=3`. Seed's own version and panel parameters are separate. Input is public URL state: do not place secrets in it. <!-- id:BfRaf7SO -->

The SDK provides `seed.input.get()`, `seed.input.push(values)`, `seed.input.replace(values)` and `seed.input.onChange(listener)`. Push adds a history entry; replace updates the current one. Both take the complete input object and validate it against the declared schema before changing the URL. Browser and desktop Back/Forward restore the input without restarting the page. Invalid incoming URLs are reported as input errors so the page can show a correction UI. <!-- id:Tirgg5Rw -->

See [custom HTML pages](./apps/document-pages.md) for sandboxing, permissions, publishing and schema-backed data storage. <!-- id:h921QMIV -->
