---
name: Domain Info
summary: "The daemon’s view of a site domain: registration, gateway status, and health-check results."
---
The daemon's view of a [site](../../protocol/sites.md) domain: registration, gateway status and health-check results. <!-- id:0-pCYFt2 -->

This page describes the **rpc/type/domain-info** read model of the [Seed API](../../build/web-api.md). The daemon computes it for clients. It is separate from the signed [blobs](../../protocol/blobs.md) that travel the network. The formal schema is attached as the `schemaDefinition` in this page's metadata, so the app can show it. <!-- id:DI-UIA2D -->

# See also <!-- id:tYzXGxPs -->

- [GetDomain](../get-domain.md): check one domain. <!-- id:HeRRjVoH -->
- [ListDomains](../list-domains.md): every known domain. <!-- id:OkEavDJa -->
- [Sites](../../protocol/sites.md): domains and gateways. <!-- id:CDlbtVTg -->
- [Seed API Schemas](../../rpc.md): the catalog of methods and read models. <!-- id:MRTbXZmC -->
