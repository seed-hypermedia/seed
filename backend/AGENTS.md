# Backend Rules

- Applies to `backend/**`, except paths with more specific local rules.
- Use `go mod` commands for dependency changes instead of editing `go.mod` or `go.sum` directly.
- Use `dqb.Str` for SQL queries, with explicit query variants for conditional logic.
- In Go tests, use `github.com/stretchr/testify/require`.
- For bug fixes, add a failing test first when practical.
- Toolchain setup: this repo uses `direnv` + `mise` to pin Go/tooling versions. In non-interactive shells, `direnv allow`
  does not automatically apply to the current process — load it explicitly before running Go commands:
  - `eval "$(direnv export zsh)"`
  This avoids errors like `go.mod: unknown block type: tool` when your global Go is too old.
- Before finishing backend work, run:
  - `eval "$(direnv export zsh)" && go test ./backend/...`
  - `eval "$(direnv export zsh)" && mise x golangci-lint@2.12.2 -- golangci-lint run --new-from-merge-base origin/main ./backend/...`
- For full CI parity before pushing, validate locally via agent-ci:
  - Lint (fast): `npx @redwoodjs/agent-ci run -w .github/workflows/lint-go.yml -p`
  - Tests (CPU llama build cached after first run): `npx @redwoodjs/agent-ci run -w .github/workflows/test-go.yml -p`
  - See `docs/local-ci-with-agent-ci.md` for setup and the fix-and-retry loop.
- Run the entire set of tests. Don't bother going bottom-up — go caches test results efficiently.
- Use `go install ./backend/...` when you just need a compile-only check.
- Follow common Go-specific naming conventions, and avoid stutter in naming.
- Write idiomatic Go code. Pay extra attention to this when working in multiple languages at the same time. Avoid
  non-idomatic patterns that might be fine in other languages like TypeScript, and others. Especially avoid Java-isms.
- If you need to implement some periodic background task — avoid using `time.Ticker`. Prefer using `time.Timer`, set
  initial interval to 0 if you need it to fire immediately, and then use `Reset` to reschedule it.
