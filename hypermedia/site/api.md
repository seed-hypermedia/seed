---
name: The Typed API
summary: The Seed read API as an Onyx catalog — every method's key, input, and output are published schemas, and the in-app API console is generated from them rather than hand-written.
---
# One call shape <!-- id:S_OZNfxS -->
Seed apps talk to a daemon through a universal client with a single call shape: `request(key, input) → output`. The `key` names a method — `Resource`, `Query`, `Search`, `ListComments` — and each method has its own input and output. Historically those shapes lived only in TypeScript. Now each one is a published schema. <!-- id:JoVBzIrS -->

# The catalog <!-- id:LJgSGvSR -->
Each method is a `seed-rpc-<method>` schema: a closed map with three properties. `key` is a string restricted by `enum` to the one method name, so the schema is self-identifying. `input` references the schema of what you pass. `output` references the schema of what comes back — often a union with `null` for "not found". For example, [RPC: Query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query) pins `key = "Query"`, takes a [hypermedia-query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia-query) — the same shape a Query block embeds in a document — and returns a [seed-query-result](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-query-result) or `null`. <!-- id:yWqxCdaY -->

[seed-rpc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc) is the union of every method. That one schema is the machine-readable table of contents for the API. A few of its variants: <!-- id:r2qlHKeD -->

<!-- id:J1dn7ZDd -->
| method <!-- col:Wo2QP7eO --> | input <!-- col:tWZVU9Xf --> | output <!-- col:4hQ9HcAi --> <!-- id:X8rcXYwI --> |
| --- | --- | --- |
| [Resource](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-resource) | a parsed id ([seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id)) | a [seed-resource](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-resource): document, comment, redirect, not-found, tombstone, or error <!-- id:DzFDAPag --> |
| [Query](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-query) | a document query | the matching documents with their metadata <!-- id:d04Gi0aw --> |
| [Search](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-search) | a query string, plus optional account scope, filters, and paging | [seed-search-results](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-search-results) <!-- id:SmHU18H9 --> |
| [ListComments](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-comments) | a target [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) | a [seed-comment-list](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-comment-list) <!-- id:B-bFPSG- --> |
| [ListCitations](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-list-citations) | a target [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) | a `citations` list of [seed-raw-citation](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-raw-citation) <!-- id:dRGNori4 --> |
| [DiscoveryStatus](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-discovery-status) | an account `uid` and `path` (optionally a version) | a [seed-discovery-status](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-discovery-status) <!-- id:C7R_aSWN --> |

Open the union page for the full list; every variant links to its own page with its exact fields. <!-- id:1IPE6PFM -->

# The read models <!-- id:eNHwY8y6 -->
The `output` side is built from the `seed-*` read models: the derived data the daemon computes for clients, as distinct from the signed blobs that travel the network. [seed-document](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-document) is a document with its versions, authors, and timestamps already resolved; [seed-id](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-id) is the parsed form of an `hm://` identifier; [seed-interaction-summary](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-interaction-summary) counts the comments, citations, and changes on a resource. The signed blobs are covered in [Onyx on the Hypermedia Network](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/hypermedia); the read models are the other half of the picture — what you actually receive. <!-- id:AqyRPHIN -->

# The console <!-- id:pntyyyx_ -->
In the Seed app, open any `seed-rpc-*` schema page (from its document here, or `/hm/schema/<cid>`): below the schema is a live call section for that method. The input is edited with the same schema-respecting value editor used everywhere else — seeded with the method's required fields, with dropdowns and reference pickers where the schema calls for them. Press **Run** and the app sends the request through the real universal client, then validates the response against the declared `output` schema, showing **matches schema** or listing the fields that did not conform. The [seed-rpc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc) page renders the whole console, with a method picker built from the union. <!-- id:Me1tBVqs -->

None of that is hand-wired. The console reads the `seed-rpc` union at runtime, so a method exists in the console exactly when its schema exists in the library. <!-- id:XJsp5ct- -->

# Why type the API <!-- id:vBYhd6xH -->
- **For people exploring:** the console is an executable reference. Every field is documented at the point you fill it in, and every response is checked against what was promised. <!-- id:fTzeqoVk -->
- **For agents and tools:** a method's contract is a resolvable document. An agent can read [seed-rpc-search](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/seed-rpc-search), construct a valid input, and know the shape it will get back — the same discipline a tool contract gives, applied to the platform itself. <!-- id:vWpJZXpp -->
- **For the codebase:** the generated TypeScript types for each read model come from these schemas, so the client, the tests, and the documentation cannot drift from each other. <!-- id:qzV0XwRb -->
- **For catching drift:** if the daemon's response ever stops matching its schema, the console shows it in red. The schema is a living assertion about the API, not a description written once. <!-- id:Ai7Pg1ST -->

# Adding a method <!-- id:bViEZFh5 -->
Add a `seed-rpc-<method>.json` with its `key` enum, `input`, and `output`; add a companion `.md`; reference it from the `seed-rpc` union; run the publisher to update the lockfile and the generators to refresh the bundled registry and TypeScript types; sync. The method then appears in the console, on its schema page, and as a typed call in the client — from one schema. The pipeline is described in [how Onyx works](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/how-it-works). <!-- id:J_7p0r19 -->