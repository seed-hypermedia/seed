---
name: Timestamp
summary: A point in time as an integer of Unix milliseconds, issued by a causal clock when a blob is signed and never checked against wall-clock time on arrival.
schemaDefinition: ipfs://bafyreieammx4j6wazd6douaqwznnu23kp3d4nj7bhyfadyfh7j4bgcebze
---
A **timestamp** says when a blob was made. It orders a signer's own changes, breaks ties between concurrent edits, and gives comments and contacts their ids. The signer claims it, and the network does not check it. <!-- id:znN-j4fF -->

This page defines the **timestamp** value type, an alias of [integer](./integer.md) used for the `ts` field of the [blob](./blob.md) envelope and for the timestamp half of a [TSID](./protocol/blobs.md). Its formal schema is attached as the `schemaDefinition` in this document's metadata, so the app can show it. <!-- id:DVkzg-Yi -->

The value is Unix milliseconds. The daemon refuses to encode or decode a time that is not rounded to a millisecond. Producers use a causal clock: a new timestamp is strictly greater than any the node has observed, and a node whose wall clock is more than 40 seconds behind the newest timestamp it has tracked refuses to issue one. On arrival nothing compares `ts` to real time. The constraints are relative: a [Change](./change.md) must be later than its dependencies and no earlier than the same signer's previous Change, and the newest snapshot blob of a record wins. The one clock check is at replay: a Change stamped 40 seconds or more ahead of the replaying node's clock fails to apply. So a signer can back-date or forward-date within those limits, and [Integrity](./protocol/integrity.md) lists this among the things that are trusted, not verified. The value zero is a sentinel used only by the deterministic genesis of a home document. <!-- id:dCrzgVYg -->

# Shape <!-- id:Ttq6DOyz -->

An **alias** of [integer](./integer.md). <!-- id:W5eiRn_4 -->

# Depends on <!-- id:A0S4HwL- -->

- [integer](./integer.md) <!-- id:scFx2aH0 -->

# See also <!-- id:2dwAshfc -->

- [blob](./blob.md): the `ts` field. <!-- id:rMB4SJhL -->
- [Integrity](./protocol/integrity.md): what is trusted and what is verified. <!-- id:aRZLRVkF -->
- [Documents](./protocol/documents.md): how timestamps order Changes. <!-- id:LnCSw9kS -->
- [date-time](./date-time.md): a human-readable instant for schemas. <!-- id:ziLlpH5M -->
