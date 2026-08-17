# Security audit log

Durable, public-safe record of security audit work. Maintained by the security auditor agent
(`docs/security/auditor.md`), which reads this file before every run.

## What lives where, and why

| Where                       | Holds                                                                         | Public                             |
| --------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| **GitHub issues**           | Fixed vulnerabilities. Filed at fix time, closed by the fix commit            | Yes — this is the disclosure event |
| **This file**               | The coverage table and the ruled-out table. Verdicts and dead hypotheses only | Yes, tracked                       |
| **`.ai/security/queue.md`** | In-flight findings: exploit detail, repro commands, evidence paths            | No — `.ai/` is gitignored          |

This repository is public. **Never record how to exploit something that is still open in this file.** Detail for unfixed
findings belongs in `.ai/security/queue.md`; it becomes public as a GitHub issue once the hole is closed and a test
proves it.

The rule that keeps the record honest: **a finding leaves the queue only by becoming a closed GitHub issue, or by
becoming a row in Ruled out with a reason.** Nothing evaporates, and nothing is deleted.

The value of this file is mostly its **negative results**. "These 40 RPCs were enumerated and 38 are guarded, here is
the verdict for each" is the thing that stops the next session re-reading the same code. Confirmed vulnerabilities are
the small part.

`audited-at`: _not yet set — no full sweep has completed._

`baseline-commit`: **f0d5abfa3** (2026-08-17). P0 ran against this commit. **No delta could be computed on that run**
because `audited-at` had never been set, so there was no previous audit point to diff from; `git log <audited-at>..HEAD`
was unrunnable. Future sessions should diff against this baseline until a full sweep sets `audited-at`. Caveat for the
record: the working tree at P0 time was dirty; the only modification under `backend/` was a comment-only change to
`private_docs_test.go` (the VULN-5 warning), so no behaviour differed from f0d5abfa3.

## Coverage

One row per pass per surface. A pass is complete only when every enumerated unit has a verdict.

| Date       | Commit    | Pass | Surface                   | Enumerated                                                                                              | Verdicts                                                                                                                                                                        | Next                                                                                      |
| ---------- | --------- | ---- | ------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 2026-08-17 | f0d5abfa3 | —    | —                         | Agent built; no audit pass has run yet                                                                  | —                                                                                                                                                                               | P0                                                                                        |
| 2026-08-17 | f0d5abfa3 | P0   | prior art — records       | 2 record files (`audit-log.md`, `.ai/security/queue.md`)                                                | Both read in full. Queue "In flight" was empty; 3 pre-seeded targets carried forward unchanged                                                                                  | —                                                                                         |
| 2026-08-17 | f0d5abfa3 | P0   | prior art — VULN-1..7     | 8 units (VULN-1, 2, 3, 4, 5, 6a, 6b, 7)                                                                 | 7 have asserting tests (fix commits `fe4e4d2d3`, `bcfef6337`, `9fae9535b`); **VULN-5 still asserts nothing (ends in `t.Log` at line 296) and stays OPEN**. Statuses re-verified | Phase 2 on VULN-5                                                                         |
| 2026-08-17 | f0d5abfa3 | P0   | prior art — incident docs | 4 docs (saturation, discovery-scanner, comment-spam, embed-rerender)                                    | All read; open follow-ups extracted and **re-verified against HEAD** — see the section below. `ci-optimization-log.md` correctly skipped (no runtime security content)          | —                                                                                         |
| 2026-08-17 | f0d5abfa3 | P0   | prior art — GitHub triage | 98 open issues; 12 protocol search terms + 4 extra (`auth`, `token`, `secret`, `admin`); 26 bodies read | Every hit given a verdict in the P0 issue triage table below. 1 migration to the queue (#901). 2 dead hypotheses recorded in Ruled out                                          | —                                                                                         |
| 2026-08-17 | f0d5abfa3 | P0   | **pass complete**         | —                                                                                                       | P0 complete. No probe run, no process started, no build/test executed. `audited-at` deliberately **left unset**: P0 is one pass, not a sweep                                    | **P1 (delta) — but see the baseline note: P1 has no delta to work from until HEAD moves** |

## Ruled out

Hypotheses that were investigated and died. Recording these is as valuable as recording findings — it prevents the same
dead end being explored every session.

| Date       | Hypothesis                                                                                                                           | Surface       | How it died                                                                                                                                                                                                                                                        | Commit checked |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 2026-08-17 | The repeated `"invalid tag"` errors in vault key import (#395) and passkeys (#376) indicate a weakness in the key-wrapping crypto    | web vault     | Both are AEAD authentication-tag failures, i.e. the code **fails closed** — decryption is refused. A denial is not a leak and gives an attacker nothing. Interop/UX bug. The vault surface itself remains unenumerated and belongs to P5                           | f0d5abfa3      |
| 2026-08-17 | Web showing 31 members where desktop shows 19 (#472) is a visibility-filter divergence between the daemon's public and private views | web / desktop | The reporter's own diagnosis is capability **sync lag** plus missing de-duplication on the web list; all member/capability data involved is public by construction, and no private-visibility predicate is implicated. Data-freshness bug, no confidentiality gain | f0d5abfa3      |

## Already-public known findings

These are **already disclosed** in this public repository — as committed test comments or as open GitHub issues — so
listing them here adds no exposure. They exist so a fresh session recognises them as known rather than reporting them as
discoveries.

| Ref                                                        | Where it is recorded                                 | Status per the code                                                                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VULN-1                                                     | `backend/api/documents/v3alpha/private_docs_test.go` | Asserting test present                                                                                                                                                                                  |
| VULN-2                                                     | same                                                 | Asserting test present                                                                                                                                                                                  |
| VULN-3                                                     | same                                                 | Asserting test present                                                                                                                                                                                  |
| VULN-4                                                     | same (comment) + `backend/daemon/http_test.go`       | Fixed, test in `http_test.go`                                                                                                                                                                           |
| VULN-5                                                     | same                                                 | **Open. The test asserts nothing — it ends in `t.Log`, so CI is green while the hole is live.** `CreateRef` hardcodes `blob.VisibilityPublic`, so a Ref created for a private document is a public blob |
| VULN-6a / VULN-6b                                          | same                                                 | Asserting tests present                                                                                                                                                                                 |
| VULN-7                                                     | same                                                 | Appears fixed; the visibility filter is applied in SQL before `LIMIT`                                                                                                                                   |
| [#957](https://github.com/seed-hypermedia/seed/issues/957) | GitHub, open                                         | Arbitrary discovery paths persist empty `rbsr_scope` rows — storage and DB-writer exhaustion. **Ships with a reproduction**, so it is the cheapest first Phase 2 target                                 |
| [#664](https://github.com/seed-hypermedia/seed/issues/664) | GitHub, open                                         | Private documents visible to local accounts that should not read them. Local-node scope, so the desktop modifier applies                                                                                |
| [#443](https://github.com/seed-hypermedia/seed/issues/443) | GitHub, closed                                       | Private-doc leak on non-gateway `PUBLIC_ONLY` servers. Historical context for the VULN-1..7 work                                                                                                        |
| [#618](https://github.com/seed-hypermedia/seed/issues/618) | GitHub, closed                                       | Path-scoped WRITER accepted by `CreateCapability`, rejected on write. The same asymmetry that breaks access-control test harnesses                                                                      |

## Known-open follow-ups from incident post-mortems

Already documented in this repo. Treat as known, not as new findings.

- `docs/daemon-saturation-incident.md` §7: per-RPC deadlines, an in-flight request cap, client-disconnect propagation,
  and a pool-wait metric.
- `docs/discovery-scanner-mitigation-report.html` §7.4 and §8: non-gateway SSR still blocks on discovery;
  headless-browser scanners can still trigger discovery; no per-IP rate limiting on the discovery endpoints; no
  negative-result caching; no bounded concurrent-discovery budget.

### Status of those follow-ups re-verified at f0d5abfa3 (P0, 2026-08-17)

The two post-mortems were written before their fixes merged, so their own prose is stale in places. Verified by reading
the code at HEAD, so later sessions do not re-derive it:

| Follow-up                                                                                           | Status at f0d5abfa3 | Evidence                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saturation §7.6 — pool-wait metric                                                                  | **Landed**          | `backend/util/sqlite/sqlitex/savepoint.go:116`, `debug_handler.go:138-140` (`PoolWaitP10/P50/P90`)                                                                   |
| Saturation §4 — `MATERIALIZED` redirect CTE                                                         | **Landed**          | `backend/api/documents/v3alpha/documents.go:2120`, `resources.go:675`                                                                                                |
| Saturation §6 — bounded citation enumeration                                                        | **Landed**          | `frontend/packages/shared/src/list-all-pages.ts` `maxPages`; `maxPages: 1` at `api-citations.ts:23` and `models/comments-resolvers.ts:163,255`                       |
| Saturation §5 — SSR interaction-summary prefetch removed                                            | **Landed**          | no `prefetchInteractionSummary` / `MAX_RESULT_SUMMARIES` remains under `frontend/apps/web/app`                                                                       |
| Saturation §7.4 — **per-RPC deadlines and an in-flight request cap**                                | **Still open**      | Re-verified live at f0d5abfa3 by reading the code. Location recorded privately (§8.1 disclosure test)                                                                |
| Saturation §7.5 — client-disconnect propagation into gRPC cancellation                              | **Still open**      | no change found on the web→daemon path                                                                                                                               |
| Saturation §7.3 — daemon-maintained citation count (#947)                                           | **Still open**      | issue #947 open                                                                                                                                                      |
| Discovery report §8 — "not deployed yet, uncommitted working-tree code"                             | **Stale — landed**  | Gateway shim verified present at f0d5abfa3 (`HMDiscoveryPendingError`, the status endpoint, and the e2e all exist). Location omitted: it is adjacent to an open hole |
| Discovery report §7.4 — **non-gateway SSR still blocks on discovery**                               | **Still open**      | Re-verified live at f0d5abfa3 by reading the code. Location recorded privately (§8.1 disclosure test)                                                                |
| Discovery report §8 — per-IP rate limit, negative-result caching, bounded concurrency for discovery | **Still open**      | Re-verified live at f0d5abfa3. #957 and #769 are already-public symptoms. Details recorded privately                                                                 |
| Discovery report §7.1 — `hmProtocolPattern` rejects hyphenated testnet names                        | **Still open**      | `backend/hmnet/hmnet.go:741` is unchanged (`(-\w+)?`). Test-infra correctness, **not** a security finding                                                            |
| Comment-spam doc §1 — per-comment `GetComment` in the desktop activity sync                         | **Landed**          | no `getComment` call remains in `frontend/apps/desktop/src/app-sync.ts`                                                                                              |
| Embed-rerender post-mortem                                                                          | **Landed**          | fixes described as shipped; client-side rendering only, no external attacker surface                                                                                 |

## P0 issue triage — 2026-08-17 at f0d5abfa3

98 open issues. Search terms run: the 12 from the protocol (`private`, `leak`, `permission`, `capability`,
`unauthorized`, `CPU`, `slow`, `hang`, `timeout`, `crash`, `spam`, `discovery`) plus `auth`, `token`, `secret`, `admin`.
`leak`, `permission`, `CPU`, `token`, `secret` and `admin` returned zero open issues. Every issue below was read and
given a verdict, using the single question: **missing guard, or unbounded cost?** Re-triaging this list is wasted work.

| Issue | Verdict                                                                                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #957  | Unbounded cost. Already recorded above; unchanged, still open, still the cheapest Phase 2 target                                                                                                            |
| #664  | Missing guard. Already recorded above; body re-read, reporter's own low-impact framing (both accounts on one node) noted but **not** inherited                                                              |
| #901  | **Missing guard.** Write-path authorization: the reporter states the server accepts signed ref blobs from a signer with no capability and simply never materialises them. **Migrated to the private queue** |
| #947  | Unbounded cost. The real fix for the citation enumeration; known-open saturation follow-up                                                                                                                  |
| #769  | Unbounded cost. Discovery with no completion bound and no negative-result caching — a live symptom of the discovery-report §8 follow-ups. No new finding                                                    |
| #457  | Unbounded cost. Same class: sync/discovery latency and prioritisation, not a guard                                                                                                                          |
| #773  | Unbounded cost, **insufficient information** — the body is literally "Reproduce required." Notify app open-latency is unenumerated; deferred to a notify pass                                               |
| #687  | Neither. Client-side render-cost code review (items 8/9/10 are local memory/render cost). No external entry point                                                                                           |
| #711  | Neither, with a cost footnote: a client retry loop against a `FailedPrecondition` redirect. Self-inflicted, own node, cheap per call. Correctness bug                                                       |
| #583  | Neither. Citation count mismatch — consistent with the documented `maxPages: 1` under-reporting trade-off; resolved by #947                                                                                 |
| #948  | Neither as reported (wrong `id` on search hits is a correctness bug). But `SearchEntities` is **not yet enumerated** for visibility filtering; that is P2 work, tracked as a P2 pointer in the queue        |
| #733  | Neither as reported (path-hierarchy integrity). Recorded as a P2 pointer: the interaction between contradictory hierarchies and path-scoped capability evaluation is untraced                               |
| #675  | Neither. Architecture-review request. Recorded as a P3/P4 pointer: the domain store performs background outbound fetches, an unenumerated surface                                                           |
| #587  | Neither. SSR emits the site-home account id in `hypermedia_id` instead of the addressed profile id; both ids are public. Recorded as a P3 pointer (identity resolution feeding cache keys)                  |
| #472  | Neither — moved to Ruled out with a reason                                                                                                                                                                  |
| #395  | Neither — moved to Ruled out with a reason (fails closed)                                                                                                                                                   |
| #376  | Neither — same fail-closed AEAD class as #395                                                                                                                                                               |
| #662  | Neither. Missing copy-link affordance for a private document. UI omission; no read or write crosses a boundary                                                                                              |
| #799  | Neither. Empty comments are publishable — input validation, not authorization. A signed comment by any principal was already possible, so no new capability                                                 |
| #429  | Neither. "Leave site" fails with an imported key; the pasted console output is analytics noise. Fails closed; insufficient information                                                                      |
| #902  | Neither. Bare 500 screenshot on publish, no reproduction. Insufficient information                                                                                                                          |
| #441  | Neither. Omnibar opens a comment in the wrong site — routing/origin selection bug, no cross-account data access                                                                                             |
| #555  | Neither. Agent cannot read comments — a capability gap, i.e. less access than intended                                                                                                                      |
| #520  | Neither. Requests unifying two vault email-verification forms. No security claim; the registration-secret surface belongs to P3/P5                                                                          |
| #383  | Neither. AI chat returns no responses. Agents/provider surface belongs to P5; no security claim in the report                                                                                               |
| #856  | Neither. Custom model-provider selector fails. Same P5 surface, fails closed                                                                                                                                |

Not triaged, with reason: the remaining open issues are editor, layout, mobile, and styling reports that matched none of
the 16 search terms and make no claim about access, cost, or identity. They are the residual for a later pass; nothing
in this table should be read as covering them.
