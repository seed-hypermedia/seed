// Package dbext provides our custom extensions for SQLite.
package dbext

// #cgo CFLAGS: -I ../../util/sqlite
// #cgo CFLAGS: -DSQLITE_CORE
// #include "dbext.h"
import "C"

// LoadExtensions loads our custom extensions into SQLite
// which will be loaded automatically by all connections.
//
// rbsr_sum requires deduplicated 32-byte SHA-256 hashes as BLOBs.
// Behavior is undefined for duplicate input. It returns a 40-byte BLOB:
// the little-endian sum modulo 2^256 followed by a little-endian uint64 count.
// Empty input returns 40 zero bytes. The function does not deduplicate or hash.
func LoadExtensions() error {
	C.load_extensions()
	return nil
}
