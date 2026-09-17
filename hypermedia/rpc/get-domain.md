---
name: "RPC: GetDomain"
summary: "Returns the daemon’s registration and health view of one site domain, optionally forcing a fresh check."
schemaDefinition: ipfs://bafyreigiykbu2fj4zvcvlpdhuwat64atcehxdghv2gsnbt4ioxbdknigoa
---
Checks the registration and health of one [site](../protocol/sites.md) domain, and can force a fresh check. The result is a [domain info](./type/domain-info.md) record. <!-- id:2l4-eCts -->

This page describes the **rpc/get-domain** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:aJPhKONp -->

# Shape <!-- id:jPvtB3gH -->

A **closed struct** with these fields: <!-- id:SzX-JA_i -->
  - `key` _(required)_: `"GetDomain"` <!-- id:0e_hZB9E -->
  - `input` _(required)_: map { 2 fields } <!-- id:qnrvoO3P -->
  - `output` _(required)_: [rpc/type/domain-info](./type/domain-info.md) <!-- id:2MN5naQ7 -->

# Depends on <!-- id:bs3kYXsk -->

- [boolean](../boolean.md) <!-- id:SUvr718b -->
- [string](../string.md) <!-- id:tc1K4yXu -->
- [rpc/type/domain-info](./type/domain-info.md) <!-- id:R5YpTEY6 -->

# See also

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication.
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console.
- [RPC](./method.md): every method in one union.
- [Sites](../protocol/sites.md): domains, gateways and site registration.
- [ListDomains](./list-domains.md): every domain the daemon knows.
- [Domain Info](./type/domain-info.md): the output shape.
