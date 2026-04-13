# Backend Rules

- Applies to `backend/**`, except paths with more specific local rules.
- Use `go mod` commands for dependency changes instead of editing `go.mod` or `go.sum` directly.
- Use `dqb.Str` for SQL queries, with explicit query variants for conditional logic.
- In Go tests, use `github.com/stretchr/testify/require`.
- For bug fixes, add a failing test first when practical.
- Before finishing backend work, run `go test ./backend/...` and
  `golangci-lint run --new-from-merge-base origin/main ./backend/...`.
- Run the entire set of tests. Don't bother going bottom-up — go caches test results efficiently.
- Use `go install ./backend/...` when you just need a compile-only check.
- Follow common Go-specific naming conventions, and avoid stutter in naming.
- Write idiomatic Go code. Pay extra attention to this when working in multiple languages at the same time. Avoid
  non-idomatic patterns that might be fine in other languages like TypeScript, and others. Especially avoid Java-isms.
