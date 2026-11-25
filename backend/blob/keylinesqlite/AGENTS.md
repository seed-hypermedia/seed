# keylinesqlite Rules

- Applies to `backend/blob/keylinesqlite/**`.

## Incremental edges

- This store keeps every subject's evaluated edges in `keyline_edges` and maintains them incrementally on `Apply`
  (`refreshEdges`). Each subject is evaluated on its own from its delegations and other subjects' stored edges, instead
  of running the core evaluator over whole connected groups. `Tx.Allows` answers from the stored edges.
- The core `keyline` package stays the oracle: it evaluates from raw facts and knows nothing about these edges. The
  conformance law `stored_edges_match_conveyed` checks the stored edges against `keyline.Conveyed` and `Tx.Allows`
  against `keyline.Members`. Any change to the refresh must keep it passing, plus the fuzzers listed in
  `backend/keyline/AGENTS.md`.

## Revocations: not incremental yet (WIP)

- Only the grant-only path is incremental. Once any revocation is stored, `rebuildEdges` clears every subject that may
  lead to a changed one and re-evaluates them in rounds, and subjects with a revoked delegation take `keyline.Conveyed`
  from the core, a full evaluation.
- Seed issues no revocations today. Before it does, make revocation handling incremental too: keep, per node, the edge
  that gives it its best power, and on a revocation re-evaluate only the nodes whose best path used the revoked edge.
  Only the revoker's admin reach is needed, not every node's. Measure the cost on the prod copy first.
