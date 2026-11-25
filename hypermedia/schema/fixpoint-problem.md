---
name: Fixpoint Problem
summary: The fixpoint problem is that a stored object cannot hold its own CID, and two objects cannot hold each other's CIDs, so schemas refer to each other by name.
---
The **fixpoint problem** is this: a stored object cannot hold its own [CID](../cid.md). The CID is a hash of the object's bytes. If the CID were inside the bytes, you would need the hash before you could compute it. <!-- id:rCmFoFNz -->

A loop has the same problem. If A holds the CID of B and B holds the CID of A, neither can be finished first.

This is why a schema refers to another schema by **name**, with an [`hm://` URL](../protocol/urls.md), and not by CID. The [meta-schema](../schema.md) can then name itself. [References and naming](./references.md) walks through it.

# See also <!-- id:3L6-CoLu -->

- [References and naming](./references.md): the full argument and the naming layer. <!-- id:X_RqIFxB -->
- [`hm://` URL](../hm-url.md): the names schemas use instead. <!-- id:EG7OHnX6 -->
- [Self-description](./self-description.md): the meta-schema's reference to itself. <!-- id:IaIRtfPR -->
- [Canonical encoding](./canonical-encoding.md): why a CID depends on exact bytes. <!-- id:HNC7wnNT -->
