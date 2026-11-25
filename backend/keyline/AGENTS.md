# Keyline Rules

- Applies to `backend/keyline/**`.

## Documentation

- Godoc owns API contracts, runnable `Example*` functions own usage, and `README.md` owns concepts: the authority rules,
  differences from upstream, replica and rotation caveats. Do not restate API contracts or code snippets in the README;
  link to the godoc or an example instead.
- Change docs in the same change as the code: godoc for contracts, examples for usage, the README for concepts.
  `TestReadme` fails when the README names a missing identifier or links to a missing file.
- Do not record point-in-time research, such as upstream PR status or "checked on <date>", in docs. Put it in the commit
  message.

## Tests

- The core `keyline` package must not test against a concrete store; its tests cover store-free behavior and runnable
  examples only. Put every store-dependent test in `keylinetest` and register it in `Run`, so `keylinemem`, Seed's
  `backend/blob/keylinesqlite`, and any future store run it. Store-specific behavior, such as locking or SQL schema,
  belongs in that store's package.
- `backend/keyline` holds the port and `keylinemem`, its reference store. Seed-specific stores live outside it and
  depend on it, never the reverse.
- `keylinetest/conformance` mirrors upstream's `keyline/src/test_utils/conformance`: `gen.go` ports `gen.rs`,
  `oracle.go` ports `oracle/naive.rs` and `oracle/threshold.rs`, and `laws.go` ports `laws.rs` with one Go function per
  law under the upstream name. Port changes there file for file, keep the generator choice for choice, and register new
  laws in `runLaws`.
- Laws for Go-only API, which upstream has no law for, live in `conformance/extensions.go`, carry no `// upstream:`
  marker, and follow the ported laws in `runLaws`. Never add them to the ported files, so `laws.go` stays a port of
  `laws.rs`.
- `stores.build` memoizes stores by record list, so every law run on one input shares the same store. Nothing prevents a
  law from changing it, and a change would silently skew later laws on that input. A law must not change the state of a
  store from `stores.build`; a law that needs to insert other facts builds its own with `stores.fresh`. The one
  exception is `idempotent`, which reapplies records the shared store already holds and requires each `Apply` to report
  no change, so the store stays as built.
- Commit inputs that `go test -fuzz` finds failing (`testdata/fuzz/<Fuzz name>/` in the store package) together with the
  fix, so they run in every later test.

## Upstream

- `UPSTREAM` pins the upstream commit and tracked paths, and lists conformance cases deliberately left unported with a
  reason. Every other upstream case needs an `// upstream: <module>::<case>` marker on the Go test or table entry that
  ports it, once across the package.
- Mark ported code that adapts a specific upstream function with a comment naming the upstream file and function, so
  upstream diffs map to Go code.
- Functionality upstream lacks, such as `MembersOf`, is listed in the README's differences
  from upstream, so a reader can tell the port from Seed's additions. Add the entry in the same change as the code.
- Run `backend/keyline/upstream.sh [ref]` to see upstream commits on tracked paths since the pin and unported or stale
  cases. It keeps a keyhive clone in `$TMPDIR/seed-keyline-upstream-clone` (override with `KEYHIVE_DIR`) and fetches it
  before each report.

To bump the pin:

1. Run `upstream.sh` and sort each upstream change into authority rules, conformance cases, or out-of-scope work
   (signing, certificates, encryption, retention). Only the first two need porting.
2. Port new or changed conformance cases first, with their markers, and confirm they fail where behavior differs.
3. Change the evaluator until they pass, then run the structured fuzzer against both oracles.
4. Update `commit` in `UPSTREAM`, add `skip` entries for cases left out on purpose, and update the README's differences
   from upstream if they changed. `upstream.sh <new-commit>` must report nothing to do.
5. Commit once, naming the upstream commit range in the message.

## Checks

```sh
direnv exec . go test -race ./backend/keyline/... ./backend/blob/keylinesqlite
direnv exec . go test ./backend/keyline/keylinemem -run '^$' -fuzz '^FuzzStructuredEvaluation$' -fuzztime=60s
direnv exec . go test ./backend/blob/keylinesqlite -run '^$' -fuzz '^FuzzStructuredEvaluation$' -fuzztime=60s
backend/keyline/upstream.sh
```
