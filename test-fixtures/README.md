# Test Fixtures

These fixtures are intentionally lightweight.

The checked-in source fixtures are:

- [`account.json`](./account.json)
- [`home.md`](./home.md)
- [`hierarchy-test.md`](./hierarchy-test.md)

Tests generate daemon state, keys, and web config from these files at runtime in
temporary directories instead of checking SQLite databases into the repository.

[`minimal-fixtures.ts`](./minimal-fixtures.ts) is only a thin loader that reads
the checked-in fixture files for the test helpers.
