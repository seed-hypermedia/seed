---
name: "RPC"
summary: "The union of every read-only method of the Seed universal-client API. Each variant pins a method key and types its input and output — the machine-readable catal"
---

# RPC

The union of every read-only method of the Seed universal-client API. Each variant pins a method key and types its input and output — the machine-readable catalog the in-app API console is driven by.


This document describes the **seed-rpc** type — a Seed API read-model schema (derived data the daemon computes for clients, not a signed network blob). Its formal schema is attached (the `schemaDefinition` in this document's metadata), so the app can show it and create values of this type.

## Shape

A **union** — a value matches one of these variants:

- [seed-rpc-account](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-account)
- [seed-rpc-account-contacts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-account-contacts)
- [seed-rpc-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-comment)
- [seed-rpc-discovery-status](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-discovery-status)
- [seed-rpc-get-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-cid)
- [seed-rpc-get-comment-reply-count](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-comment-reply-count)
- [seed-rpc-get-domain](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-domain)
- [seed-rpc-interaction-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-interaction-summary)
- [seed-rpc-list-accounts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-accounts)
- [seed-rpc-list-capabilities](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-capabilities)
- [seed-rpc-list-changes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-changes)
- [seed-rpc-list-citations](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-citations)
- [seed-rpc-list-comment-versions](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comment-versions)
- [seed-rpc-list-comments](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments)
- [seed-rpc-list-comments-by-author](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments-by-author)
- [seed-rpc-list-comments-by-reference](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments-by-reference)
- [seed-rpc-list-discussions](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-discussions)
- [seed-rpc-list-document-collaborators](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-document-collaborators)
- [seed-rpc-list-domains](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-domains)
- [seed-rpc-list-events](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-events)
- [seed-rpc-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query)
- [seed-rpc-query-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query-block)
- [seed-rpc-resource](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-resource)
- [seed-rpc-resource-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-resource-metadata)
- [seed-rpc-search](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-search)
- [seed-rpc-subject-contacts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-subject-contacts)

## Depends on

- [seed-rpc-account](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-account)
- [seed-rpc-account-contacts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-account-contacts)
- [seed-rpc-comment](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-comment)
- [seed-rpc-discovery-status](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-discovery-status)
- [seed-rpc-get-cid](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-cid)
- [seed-rpc-get-comment-reply-count](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-comment-reply-count)
- [seed-rpc-get-domain](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-get-domain)
- [seed-rpc-interaction-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-interaction-summary)
- [seed-rpc-list-accounts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-accounts)
- [seed-rpc-list-capabilities](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-capabilities)
- [seed-rpc-list-changes](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-changes)
- [seed-rpc-list-citations](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-citations)
- [seed-rpc-list-comment-versions](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comment-versions)
- [seed-rpc-list-comments](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments)
- [seed-rpc-list-comments-by-author](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments-by-author)
- [seed-rpc-list-comments-by-reference](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments-by-reference)
- [seed-rpc-list-discussions](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-discussions)
- [seed-rpc-list-document-collaborators](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-document-collaborators)
- [seed-rpc-list-domains](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-domains)
- [seed-rpc-list-events](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-events)
- [seed-rpc-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query)
- [seed-rpc-query-block](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query-block)
- [seed-rpc-resource](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-resource)
- [seed-rpc-resource-metadata](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-resource-metadata)
- [seed-rpc-search](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-search)
- [seed-rpc-subject-contacts](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-subject-contacts)
