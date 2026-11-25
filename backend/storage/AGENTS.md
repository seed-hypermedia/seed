# Backend Storage Rules

- Applies to `backend/storage/**`.
- `backend/storage/schema.sql` is the schema source of truth.
- When schema changes, update migrations in `backend/storage/storage_migrations.go` and follow the guidance comment in
  that file.
- After schema or migration changes, run `./dev gen //backend/...` from the repository root.
- Validate schema/migration changes against full CI locally before pushing:
  `npx @redwoodjs/agent-ci run -w .github/workflows/test-go.yml -p`. See `hypermedia/contribute/local-ci.md`.
- Be careful to introduce new migrations where a reindex is required and embeddings need to be re-computed. CPU-only
  servers will take longer to process them again, consuming a lot of CPU along the way.
- When adding or changing indexes, think about the queries that use them:
  - If a query reads one or two cheap columns past an index's key (integers, short values), consider appending them so
    the index covers the query and SQLite skips the row lookup.
  - Prefer extending an existing index, such as one a foreign key requires, over adding another.
  - `WITHOUT ROWID` is fine for short keys. With a long text primary key and several secondary indexes, prefer a rowid
    table, since every secondary index entry repeats the primary key.
  - Don't drop an index that existing queries rely on.
