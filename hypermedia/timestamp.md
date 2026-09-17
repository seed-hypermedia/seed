---
name: Timestamp
summary: A point in time as an integer of Unix milliseconds, issued by a causal clock when a blob is signed and never checked against wall-clock time on arrival.
schemaDefinition: ipfs://bafyreieammx4j6wazd6douaqwznnu23kp3d4nj7bhyfadyfh7j4bgcebze
---
Every blob says when it was made. The timestamp orders a signer's own changes, breaks ties between concurrent edits, and gives comments and contacts their ids; it is a claim by the signer rather than a fact the network checks. <!-- id:znN-j4fF -->

This page defines the **timestamp** value type, an alias of [integer](./integer.md) used for the `ts` field of the [blob](./blob.md) envelope and for the timestamp half of a TSID. Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it. <!-- id:DVkzg-Yi -->

The value is Unix milliseconds, and the daemon refuses to encode or decode a time that is not rounded to a millisecond. Producers use a causal clock: a new timestamp is strictly greater than any the node has observed, and a node whose wall clock is more than 40 seconds behind the newest timestamp it has tracked refuses to issue one. On arrival nothing compares `ts` to real time; the constraints are relative, a Change must be later than its dependencies and than the same signer's previous Change, and the newest snapshot blob of a record wins. A signer can therefore back-date or forward-date within those limits, which [Integrity](./protocol/integrity.md) lists among the things that are trusted rather than verified. The value zero is a sentinel used only by the deterministic genesis of a home document. <!-- id:dCrzgVYg -->

# Shape <!-- id:Ttq6DOyz -->

An **alias** of [integer](./integer.md). <!-- id:W5eiRn_4 -->

# Depends on <!-- id:A0S4HwL- -->

- [integer](./integer.md) <!-- id:scFx2aH0 -->
