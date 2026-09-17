---
name: "RPC: GetDomain"
summary: Returns the daemon’s registration and health view of one site domain, optionally forcing a fresh check.
---
Checks the registration and health of one [site](../protocol/sites.md) domain, and can force a fresh check. The result is a [domain info](./type/domain-info.md) record. <!-- id:2l4-eCts -->

This page describes the **rpc/get-domain** method. It is one method of the [Seed API](../build/web-api.md), which clients call as `request(key, input) -> output`. `input` types what you send and `output` types what comes back. The output is a read model that the daemon computes for clients, separate from the signed [blobs](../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it and run the method from its [API console](../rpc.md). <!-- id:aJPhKONp -->

# See also <!-- id:BXSGGL9_ -->

- [Seed API](../build/web-api.md): HTTP transport, input encodings, errors and authentication. <!-- id:I5JVfBXn -->
- [Seed API Schemas](../rpc.md): the catalog of methods and the in-app console. <!-- id:_eq1LlYN -->
- [RPC](./method.md): every method in one union. <!-- id:G9eMA30O -->
- [Sites](../protocol/sites.md): domains, gateways and site registration. <!-- id:yRcrlh05 -->
- [ListDomains](./list-domains.md): every domain the daemon knows. <!-- id:SQuTqGQV -->
- [Domain Info](./type/domain-info.md): the output shape. <!-- id:CMB4MK6R -->
