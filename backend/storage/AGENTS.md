# Backend Storage Rules

- Applies to `backend/storage/**`.
- `backend/storage/schema.sql` is the schema source of truth.
- When schema changes, update migrations in `backend/storage/storage_migrations.go` and follow the guidance comment in that file.
- After schema or migration changes, run `./dev gen //backend/...` from the repository root.
