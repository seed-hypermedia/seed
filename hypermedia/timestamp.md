---
name: Timestamp
summary: A point in time as an integer of Unix milliseconds, issued by a causal clock when a blob is signed and never checked against wall-clock time on arrival.
---
A **timestamp** says when a [blob](./protocol/blobs.md) was made. It is a whole number: Unix time in milliseconds. The signer writes it, and the network does not check it against real time. <!-- id:znN-j4fF -->

A timestamp does three jobs:

- It orders a signer's own [changes](./change.md).
- It breaks ties between edits made at the same time.
- It gives [comments](./protocol/comments.md) and [contacts](./protocol/contacts.md) their ids.

This page defines the **timestamp** value type. It is another name for [integer](./integer.md), used for the `ts` field of the [blob](./blob.md) envelope and for the timestamp half of a [TSID](./protocol/blobs.md). The type's formal schema is attached to this page as the `schemaDefinition` in its [metadata](./metadata.md). So the app can show it. <!-- id:DVkzg-Yi -->

# How a timestamp is made

The value is Unix milliseconds. The [daemon](./software/daemon.md) refuses to encode or decode a time that is not rounded to a millisecond. <!-- id:dCrzgVYg -->

A node makes timestamps with a causal clock:

- A new timestamp is strictly greater than every timestamp the node has seen.
- A node whose wall clock is 40 seconds or more behind the newest timestamp it has tracked refuses to issue one.

# How a timestamp is checked

When a blob arrives, nothing compares `ts` to real time. The rules compare timestamps to each other:

- A [Change](./change.md) must be later than its dependencies.
- A Change must be no earlier than the same signer's previous Change.
- The newest snapshot blob of a record wins.

There is one clock check, at replay. A Change stamped 40 seconds or more ahead of the replaying node's clock fails to apply.

So a signer can set a timestamp earlier or later than the real time, within those limits. [Integrity](./protocol/integrity.md) lists this among the things that are trusted and not verified.

The value zero is a special marker. Only the deterministic genesis of a [home document](./protocol/spaces.md) uses it.

# See also <!-- id:2dwAshfc -->

- [blob](./blob.md): the `ts` field. <!-- id:rMB4SJhL -->
- [Integrity](./protocol/integrity.md): what is trusted and what is verified. <!-- id:aRZLRVkF -->
- [Documents](./protocol/documents.md): how timestamps order Changes. <!-- id:LnCSw9kS -->
- [date-time](./date-time.md): a human-readable instant for schemas. <!-- id:ziLlpH5M -->
- [Catalogue of types](./schema/types.md): every type in the library.
