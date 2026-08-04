# Backend Storage Rules

- Applies to `backend/storage/**`.
- `backend/storage/schema.sql` is the schema source of truth.
- When schema changes, update migrations in `backend/storage/storage_migrations.go` and follow the guidance comment in that file.
- After schema or migration changes, run `./dev gen //backend/...` from the repository root.
- Validate schema/migration changes against full CI locally before pushing: `npx @redwoodjs/agent-ci run -w .github/workflows/test-go.yml -p`. See `docs/local-ci-with-agent-ci.md`.
- Be careful to introduce new migrations where a reindex is required and embeddings need to be re-computed. CPU-only servers will take longer to process them again, consuming a lot of CPU along the way.
