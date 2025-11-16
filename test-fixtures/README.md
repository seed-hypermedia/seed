# Test Fixtures

Test data for integration tests.

## Structure

- `daemon/` - Daemon database fixtures for GraphQL integration tests

## Adding Test Data

To add test data to fixtures:

1. Run daemon locally pointing to test-fixtures directory:
   ```bash
   go run backend/cmd/seed-daemon -data-dir test-fixtures/daemon -http.port 59999
   ```

2. Create test documents/data using the running daemon

3. Stop daemon - data is now in `test-fixtures/daemon/`

4. Commit the fixtures to git

## Usage in Tests

Tests automatically:
1. Copy `test-fixtures/` to OS temp directory
2. Run daemon against temp copy
3. Execute tests
4. Clean up temp directory

This keeps checked-in fixtures pristine.
