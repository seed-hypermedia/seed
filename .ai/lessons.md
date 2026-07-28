# Lessons

## Vault vs Account hierarchy
- **Vault level**: Biometric Login, Master Password, Email Address — these apply to the ENTIRE vault, not per account
- **Account level**: Profile, Account ID, Connected Sites, Back Up Account, Delete Account — these are per individual Hypermedia account
- We do NOT know whether an account has been backed up — never show backup status badges
- Backup/Restore is a per-account action, not a vault-wide action

## Don't compile or run the daemon on this machine unprompted
- `go build ./backend/...` and especially `go test ./backend/blob/... ./backend/hmnet/...` froze Julio's machine (cgo SQLite amalgamation + parallel package tests saturate CPU/RAM).
- **Rule**: write the code, then STOP. Let Julio compile and test. Report exactly which verification steps were run vs. skipped so he knows what's unproven.
- If a build check is unavoidable, scope it to one package (`go build ./backend/util/foo/`) and say why first — never `./backend/...` and never a multi-package `go test`.
- Reading code, `grep`, `git status` are all fine. It's the toolchain that hurts.

## Sync performance metrics: throughput needs three denominators
- Bytes ÷ one session's elapsed time is a lie: sync arrives in bursts (fast while active, slow as perceived) and sessions run concurrently (summing durations double-counts overlap).
- Correct shape: one numerator, three denominators — uptime (perceived), **union** of active intervals (pipe capacity), Σ session durations (per-stream). Duty cycle = busy÷uptime bridges them: `wall = active × dutyCycle`.
- Export time as a `_seconds_total` **counter**, never a precomputed rate — Prometheus then derives any window for free.
- Union-not-sum is the concurrency fix. Track `active` count; accumulate the interval only on the 1→0 transition.

## Grep for the symbol you actually changed, not a list you wrote earlier
- After adding a parameter to `SessionStart` and renaming `classifyDelay`, I checked the test file for a list of symbols — and that list didn't include either of the two things I'd just changed. Reported "tests don't touch the changed API"; the build then failed on 7 call sites.
- **Rule**: when renaming a symbol or changing a signature, the grep pattern is *that symbol's old name*. Derive the pattern from the diff, never from memory.
- Corollary: don't state a verification result more broadly than the check performed. "No references to `X`, `Y`, `Z`" is honest; "tests don't touch the changed API" claims a completeness the grep didn't have.
- This matters double here because Julio compiles, not me — a false all-clear costs him a round trip.

## Before deleting a "should not exist" workaround, find out what it was working around
- Julio's correction on `blob.mapToCBOR`: *"first understand why it says it is a workaround, workaround of what? maybe it will stop working if you dont understand why it was there in the first place."*
- The TODO said "should not exist", which read like dead weight. It wasn't: ops are an **inline-discriminated union**, which refmt/atlas cannot express (its union support needs a keyed envelope). The CBOR round-trip was borrowing the codec as a generic map→struct converter, and it silently supplied four behaviours — refmt tag mapping, embedded-struct flattening, `Block`/`Annotation` transform dispatch, and type coercion.
- Reading the **dependency's** decoder was what made the rewrite safe. From `refmt@v0.89.1`: wildcard CBOR ints decode to plain `int` (not int64) for both TInt and TUint; `[]` → non-nil empty slice but `null` → nil slice; unsigned fields reject negatives; unknown struct fields are a hard `ErrNoSuchField`. Any of those, guessed wrong, is a silent data bug.
- **Rule**: a workaround comment tells you it's ugly, not that it's useless. Enumerate what it provides, verify each against the library source, and keep the old implementation as a `reflect.DeepEqual` test oracle. Where the old code called a helper directly (`mapstruct`), reuse that same helper rather than reimplementing its semantics.
