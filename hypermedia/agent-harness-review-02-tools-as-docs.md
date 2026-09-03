---
name: "Checkmark review — M2: tools as documents (harness/02-tools-as-docs)"
summary: "Status: verified — ready for Eric's review. (Local commits only; not pushed.)"
---
Status: **verified — ready for Eric's review.** (Local commits only; not pushed.) <!-- id:UqD2Stme -->

# What changed <!-- id:5I2ckUDM -->

Every callable tool is now a content-addressed document in the agent's Space, and the system prompt carries a cached, byte-budgeted index of that Space. <!-- id:NRiaNfgJ -->
  - `agents/src/tool-documents.ts` (new) — the document layer. A tool document is `{name, kind: builtin | lambda, summary, description, input, output?, source?, runtime?, binding?}`, encoded as canonical DAG-CBOR with a CIDv1 — the same encoding the hypermedia network uses for blobs, so publishing a tool later is publishing bytes that already exist. Builtins materialize per agent via an idempotent upsert (rows rewritten only when the registry contract's CID changed). Lambda documents are validated hard at save (name pattern, builtin-name protection, source and description size caps, schema-shape checks) because the index and the call verb trust stored documents. <!-- id:Wa12W-ks -->
  - `tool_documents` table — migration + baseline schema (prepend-ordered migrations array with the trailing `.reverse()` — noted because it almost bit). <!-- id:XZbH6ZwZ -->
  - **Verb wiring**: `read ~/tools/` lists from documents (authored lambdas marked); `read ~/tools/<name>` returns the stored contract with its CID (verbs still answer from the registry); `write ~/tools/<name>` authors a lambda from JSON content ({description, input, output?, source, runtime?}) or deletes with {delete: true}; `call` on an authored lambda answers with a clear not-yet-callable error naming its contract address (execution lands in M4). <!-- id:hRzdrU7w -->
  - **The Space index** (`buildSpaceIndex`): one `<space>` block in every run's system prompt — callable tools one line each, the memory top level compacted (`notes/(3) · media/(1)`), active triggers. Byte-budgeted (2 KB) with an honest fallback to counts when over; **cached per agent** and invalidated at every mutation site (agent memory writes from sessions, scripts, and user API actions; tool authoring; trigger create/update/delete) — this also retires the M1 review's per-turn recursive memory-walk finding. Replaces both the `<tools>` block and `<memory_files>`. <!-- id:d8Kt9-CH -->
  - **Touch-expand pins**: the transcript is the pin. Any durable `read ~/tools/<name>` or `call` of a tool promotes that callable to a **first-class provider tool** on every later turn of the thread (`expandedCallablesFromEvents` scan → real tool definitions + names in the Pi session). Resume, park, restart, and future compaction reconstruct the identical set from the identical events — no new event type, no in-memory state. <!-- id:dWb1mCsa -->

# How it was verified <!-- id:dE96eIe6 -->

- New suites: `tool-documents.test.ts` (5 tests: upsert idempotence + CID stability, drift refresh, lambda validation matrix, delete protection, contract markdown) and three additions to `verbs.test.ts` (index budget/caching/invalidation, authored-lambda listing + contract + CID, expanded-set derivation from durable events). <!-- id:oeQRTrLA -->
- Full agents suite **229 pass / 0 fail**; typecheck clean. <!-- id:Vb-ywNyf -->
- **Adversarial review (high): 11 confirmed correctness findings, all dispositioned.** Fixed: a genuine security hole — unfiltered touch-expand promotion let a hallucinated `call {tool: "bash"}` durably store that name and next turn hand it to Pi's provider allowlist, activating Pi's own host bash/edit builtins outside the sandbox (promotion now normalizes and intersects with the enabled callable set); agent deletion FK-violating on tool_documents (undeletable agents); the write verb silently re-granting publishing to deliberately read-only agents — restored as a `publish` grant (legacy write-group names map onto it, the desktop gets a "Publish Seed content" toggle, memory writes never gated); space-index cache keyed without the callable set and never invalidated on agent update/delete; call-verb gate missing legacy-name normalization (execute_code loops); the desktop Tools tab misreporting legacy execute_code agents with no UI path to disable (stored arrays now normalize on load and save); the space index listing other agents' triggers (missing agent_id filter); lambda names allowed to shadow the five verbs; parallel long sleeps overwriting each other's wake time instead of keeping the earliest; and the https hypermedia fallback swallowing transient daemon errors (now falls through only on the resolver's explicit not-hypermedia marker or a 404). Also removed the orphaned memoryListingPrompt. Cut-list items deferred with reasons: run-card live-subscription and query-invalidation efficiency belong to M3's UI pass; transcript-rescan caching noted for M5 when the scan gains wake sources. <!-- id:kzz1f5lc -->
- Post-fix gates: agents **230 pass / 0 fail**, desktop **259 pass / 0 fail**, typechecks clean. <!-- id:SJWqlvRC -->
- Desktop spot-check: system prompt viewer shows `<space>`; the Tools tab gains the publish toggle; no other UI changes required. <!-- id:GlV1494Q -->

# Known gaps / decisions to flag <!-- id:wXl5KhVz -->

<!-- id:HVm1kp4C -->
- Lambdas are authorable and listed but not callable until M4 wires them to the execute sandbox; the call verb says so explicitly when asked. <!-- id:1UpiI2DX -->
- Tool documents are per-agent rows; publishing them as signed hypermedia documents (network install/share) is deliberately deferred until the grants story (M6+/consent) exists. <!-- id:h6pdm4wA -->
- The expansion scan counts any `call` of a tool as expansion (used = expanded). A tool the model calls blind and gets a contract-miss for is also promoted next turn — intended: the contract is now in context either way. <!-- id:ElS5UXH0 -->

## Since this review (2026-08-13) <!-- id:Djx2ogG8 -->

- **Lambdas are callable.** M4 wired `~/tools/<name>` documents to the execute sandbox — input validated against the document's own schema on the way in, the return value against its output schema on the way out, and the same `execute` grant enforced — so the "not callable until M4" gap above is closed and that error path is gone. <!-- id:i1-T9vFc -->
- **Authored tools are visible in the GUI.** A `ListAgentTools` action was added and the desktop Tools tab lists what the agent wrote for itself, which the review's "no other UI changes required" note predates. <!-- id:daiI4YOt -->
- **The expansion scan gained an actor filter.** M3 made a user's palette call replay as text rather than a tool exchange, and `expandedCallablesFromEvents` now skips `actor: 'user'` events so a person's call cannot reshape the agent's provider toolset. <!-- id:qZucfkHg -->
- Still true: tool documents remain per-agent rows, not signed hypermedia documents; publishing them waits on the grants story. The promotion filter, the space-index cache key, the verb-name shadowing guard, the `publish` grant and the FK cleanup on agent delete are all still in place. <!-- id:lK2fS8IB -->

# Eric's three-minute test <!-- id:LHAx1-XR -->

1. Ask an agent: "what tools do you have?" — expect a `read ~/tools/` row listing verbs + callables, matching the `<space>` block in the session's system-prompt viewer. <!-- id:YVLEFsmF -->
2. Ask it to author a tool: "make yourself a tool called word_count that counts words" — expect `write ~/tools/word_count` with a CID in the result, the tool appearing in `~/tools` listings, and a clear "not callable until lambda execution ships" answer if it tries to call it._ <!-- id:-Mrp249X -->
3. Ask for a web search, then in a later message another one — expect the first to go through `call`, and subsequent turns to show `web_search` as its own tool row (promotion). <!-- id:5gxEsIn5 -->
