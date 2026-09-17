---
name: "RPC: ListDomains"
summary: Returns every site domain the daemon knows, each with its registration and health info.
schemaDefinition: ipfs://bafyreidlmqv7wr7wbybpocgdd2ok5yxgwyu74n35x63fcpjkbdquc3wqka
---
Lists every [site](../protocol/sites.md) domain the daemon knows, each with its registration and health info as [domain info](./type/domain-info.md). <!-- id:EU590VBL -->

This page describes the **rpc/list-domains** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:EUFuDI5u -->

# Shape <!-- id:FQW6uXz3 -->

A **closed struct** with these fields: <!-- id:9151imY0 -->
  - `key` _(required)_: `"ListDomains"` <!-- id:N6se43YX -->
  - `input` _(required)_: map <!-- id:bKAFDwFF -->
  - `output` _(required)_: map { 1 fields } <!-- id:VFyNONl3 -->

# Depends on <!-- id:MHXgMWho -->

- [rpc/type/domain-info](./type/domain-info.md) <!-- id:YRWfuQiw -->

# See also <!-- id:xNSMDkYR -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:FPN1J4mK -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:OUF1nM5X -->
- [RPC](./method.md): every method in one union. <!-- id:rZcUZfTh -->
- [Sites](../protocol/sites.md): domains and gateways. <!-- id:YBjUOeRc -->
- [GetDomain](./get-domain.md): check one domain. <!-- id:Ns17oRrq -->
