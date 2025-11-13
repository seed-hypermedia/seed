package storage

import (
	"context"
	"os"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/sqlitedbg"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSQLite(t *testing.T) {
	pool, err := OpenSQLite("file::memory:?mode=memory&cache=shared", 0, 1)
	require.NoError(t, err)

	defer pool.Close()

	sqlitedbg.ExecPool(pool, os.Stdout, "select sha1('hello')")
	sqlitedbg.ExecPool(pool, os.Stdout, "select mycount() from (values (1), (2));")
	sqlitedbg.ExecPool(pool, os.Stdout, "select * FROM carray(rb_array(rb_create(1,2,3,4,5,6,1000,130,145,5000)), 10)")
}

func TestBase58BTC(t *testing.T) {
	pool, err := OpenSQLite("file::memory:?mode=memory&cache=shared", 0, 1)
	require.NoError(t, err)
	defer pool.Close()

	// Test vectors from IETF Base58 specification
	testVectors := []struct {
		name    string
		input   string
		encoded string
	}{
		{
			name:    "Hello World",
			input:   "Hello World!",
			encoded: "2NEpo7TZRRrLZSi2U",
		},
		{
			name:    "The quick brown fox jumps over the lazy dog",
			input:   "The quick brown fox jumps over the lazy dog.",
			encoded: "USm3fpXnKG5EUBx2ndxBDMPVciP5hGey2Jh4NDv6gmeo1LkMeiKrLJUUBk6Z",
		},
	}

	conn, release, err := pool.Conn(context.Background())
	require.NoError(t, err)
	defer release()

	for _, tv := range testVectors {
		t.Run(tv.name, func(t *testing.T) {
			// Test encoding
			var encoded string
			err := sqlitex.Exec(conn, "SELECT base58btc_encode(cast(? as BLOB))", func(stmt *sqlite.Stmt) error {
				encoded = stmt.ColumnText(0)
				return nil
			}, tv.input)
			require.NoError(t, err)
			require.Equal(t, tv.encoded, encoded, "encoding mismatch")

			// Test decoding
			var decoded string
			err = sqlitex.Exec(conn, "SELECT cast(base58btc_decode(?) as TEXT)", func(stmt *sqlite.Stmt) error {
				decoded = stmt.ColumnText(0)
				return nil
			}, tv.encoded)
			require.NoError(t, err)
			require.Equal(t, tv.input, decoded, "decoding mismatch (round trip)")
		})
	}

	// Test vector with leading zeros (0x0000287fb4cd -> 11233QC4)
	// Two leading zero bytes should produce two leading '1' characters.
	t.Run("leading zeros", func(t *testing.T) {
		// Encode: 0x0000287fb4cd should produce 11233QC4
		var encoded string
		err := sqlitex.Exec(conn, "SELECT base58btc_encode(x'0000287fb4cd')", func(stmt *sqlite.Stmt) error {
			encoded = stmt.ColumnText(0)
			return nil
		})
		require.NoError(t, err)
		require.Equal(t, "11233QC4", encoded)

		// Decode: 11233QC4 should produce 0x0000287fb4cd
		var decoded []byte
		err = sqlitex.Exec(conn, "SELECT base58btc_decode(?)", func(stmt *sqlite.Stmt) error {
			decoded = stmt.ColumnBytes(0)
			return nil
		}, "11233QC4")
		require.NoError(t, err)
		require.Equal(t, []byte{0x00, 0x00, 0x28, 0x7f, 0xb4, 0xcd}, decoded)
	})

	// Bitcoin address round-trip tests (decode then re-encode should give original)
	bitcoinAddresses := []struct {
		S string
		B []byte
	}{
		{"1QCaxc8hutpdZ62iKZsn1TCG3nh7uPZojq", []byte{0, 254, 123, 208, 224, 3, 43, 141, 44, 17, 86, 132, 31, 160, 96, 20, 86, 170, 172, 143, 60, 14, 241, 109, 140}},
		{"1DhRmSGnhPjUaVPAj48zgPV9e2oRhAQFUb", []byte{0, 139, 70, 210, 84, 160, 131, 209, 12, 227, 241, 47, 94, 149, 67, 186, 115, 31, 33, 242, 169, 111, 235, 42, 96}},
		{"17LN2oPYRYsXS9TdYdXCCDvF2FegshLDU2", []byte{0, 69, 122, 54, 187, 107, 238, 228, 234, 211, 96, 149, 55, 218, 101, 140, 2, 98, 62, 190, 136, 8, 109, 24, 199}},
		{"14h2bDLZSuvRFhUL45VjPHJcW667mmRAAn", []byte{0, 40, 122, 87, 205, 190, 123, 92, 248, 15, 118, 48, 155, 41, 117, 109, 37, 134, 96, 7, 43, 48, 218, 103, 123}},
	}

	for _, addr := range bitcoinAddresses {
		t.Run("btc_address_"+addr.S, func(t *testing.T) {
			// Decode address
			var decoded []byte
			err := sqlitex.Exec(conn, "SELECT base58btc_decode(?)", func(stmt *sqlite.Stmt) error {
				decoded = stmt.ColumnBytes(0)
				return nil
			}, addr.S)
			require.NoError(t, err)
			require.Equal(t, addr.B, decoded)

			// Re-encode and verify it matches original
			var reencoded string
			err = sqlitex.Exec(conn, "SELECT base58btc_encode(?)", func(stmt *sqlite.Stmt) error {
				reencoded = stmt.ColumnText(0)
				return nil
			}, decoded)
			require.NoError(t, err)
			require.Equal(t, addr.S, reencoded, "round-trip encoding failed for address %s", addr)
		})
	}

	// Test invalid characters - these are excluded from base58btc alphabet
	invalidChars := []string{"0", "O", "I", "l"}
	for _, invalid := range invalidChars {
		t.Run("invalid_char_"+invalid, func(t *testing.T) {
			// Valid base58btc string with an invalid character inserted
			testStr := "1A" + invalid + "BCD"
			err := sqlitex.Exec(conn, "SELECT base58btc_decode(?)", func(stmt *sqlite.Stmt) error {
				return nil
			}, testStr)
			require.Error(t, err, "should error on invalid character %s", invalid)
			require.Contains(t, err.Error(), "Invalid base58btc character")
		})
	}
}
