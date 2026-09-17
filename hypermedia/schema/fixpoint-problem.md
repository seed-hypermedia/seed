---
name: Fixpoint Problem
summary: The impossibility of putting a block's own CID inside its own content, which also means a cycle of CIDs has no encoding order.
---
**Fixpoint problem**: a block cannot contain its own [CID](../cid.md), because computing that CID would mean finding a hash preimage. For the same reason, a _cycle_ of CIDs has no encoding order. This is why schema references are **names**. [References and naming](./references.md) walks through it. <!-- id:rCmFoFNz -->

# See also <!-- id:3L6-CoLu -->

- [References and naming](./references.md): the full argument and the naming layer. <!-- id:X_RqIFxB -->
- [`hm://` URL](../hm-url.md): the names schemas use instead. <!-- id:EG7OHnX6 -->
- [Self-description](./self-description.md): the meta-schema's reference to itself. <!-- id:IaIRtfPR -->
- [Canonical encoding](./canonical-encoding.md): why a CID depends on exact bytes. <!-- id:HNC7wnNT -->
