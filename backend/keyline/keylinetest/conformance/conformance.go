// Package conformance ports Keyline's upstream conformance laws, generator,
// and oracles (keyline/src/test_utils/conformance in keyhive) to any
// keyline.Store. It mirrors upstream's layout: gen.go ports gen.rs, oracle.go
// ports oracle/naive.rs and oracle/threshold.rs, and laws.go ports laws.rs one
// law per function. extensions.go adds laws for Go-only API upstream lacks.
//
// A store package calls Run from its tests, and FuzzEvaluation and
// FuzzStructuredEvaluation from its fuzz targets.
package conformance

import (
	"fmt"
	"iter"
	"math/rand/v2"
	"testing"

	"seed/backend/keyline"
	"seed/backend/keyline/keylinetest"

	"github.com/stretchr/testify/require"
)

// NewStore returns a new, empty store owned by one test.
type NewStore = keylinetest.NewStore

// Run checks every law on each planted shape and on 16 generated sets (4 with
// -short), the counterpart of upstream's bolero runs in cargo test. The sweep
// is deterministic; use go test -fuzz with the fuzz targets to search further.
func Run(t *testing.T, newStore NewStore) {
	sweep := 16
	if testing.Short() {
		sweep = 4
	}

	for i, data := range corpus(sweep) {
		t.Run(fmt.Sprint(i), func(t *testing.T) { runInput(t, newStore, data) })
	}
}

// corpus returns each planted shape with no extra wiring, then n random inputs.
func corpus(n int) [][]byte {
	var inputs [][]byte

	for shape := range byte(5) {
		// One subject rooted at Write in node 2, no free-form edges, and the shape.
		inputs = append(inputs, []byte{0, 1, 0, 0, shape})
	}

	rng := rand.New(rand.NewPCG(59, 83)) //nolint:gosec // Deterministic test-data generator.
	for range n {
		data := make([]byte, 160)
		for i := range data {
			data[i] = byte(rng.Uint32() & 0xff)
		}

		inputs = append(inputs, data)
	}

	return inputs
}

// runInput decodes one input as upstream's (CertSet, u64) and runs every law.
func runInput(t *testing.T, newStore NewStore, data []byte) {
	u := &unstructured{data}
	set := arbitraryCertSet(u)
	runLaws(t, newStore, set, u.uint64())
}

// FuzzStructuredEvaluation fuzzes every law over sets from upstream's
// generator, with stores from newStore.
func FuzzStructuredEvaluation(f *testing.F, newStore NewStore) {
	// Run already covers the random sweep; seed only the planted shapes.
	for _, data := range corpus(0) {
		f.Add(data)
	}

	f.Fuzz(func(t *testing.T, data []byte) { runInput(t, newStore, data) })
}

// FuzzEvaluation fuzzes every law over arbitrary small sets of pool facts,
// which are mostly ungrounded. Every complete five-byte chunk is a valid fact,
// so fuzzing explores derivations rather than parse rejection.
func FuzzEvaluation(f *testing.F, newStore NewStore) {
	f.Add([]byte{})
	// Root grant, attenuated delegation, and a third-party revocation.
	f.Add([]byte{1, 0, 1, 0, 3, 1, 1, 2, 0, 1, 0, 0, 1, 0, 0})

	f.Fuzz(func(t *testing.T, data []byte) {
		var set certSet

		for i := 0; i < min(len(data)/5, 24); i++ {
			b := data[5*i : 5*i+5]
			if b[0]%4 == 0 {
				set = append(set, keyline.Revocation{
					ID: keyline.ID(fmt.Sprintf("r%d", i)), Issuer: node(1 + int(b[1])%pool), Target: keyline.ID(fmt.Sprintf("d%d", b[2]%24)), BlobID: 1,
				})
			} else {
				set = append(set, keyline.Delegation{
					ID: keyline.ID(fmt.Sprintf("d%d", i)), Issuer: node(1 + int(b[1])%pool), Audience: node(1 + int(b[2])%pool),
					Subject: node(1 + int(b[3])%pool), Power: powerOrder[1+b[4]%4], BlobID: 1,
				})
			}
		}

		runLaws(t, newStore, set, uint64(len(data)))
	})
}

// Keep expectations independent of Power.Compare.
var powerOrder = []keyline.Power{keyline.None, keyline.Sync, keyline.Read, keyline.Write, keyline.Admin}

// testFacts is the fact set the oracles read.
type testFacts struct {
	Delegations []keyline.Delegation
	Revocations []keyline.Revocation
}

// testQueries reads public queries through fresh read transactions.
type testQueries struct {
	t     *testing.T
	store keyline.Store
}

func (q testQueries) EffectivePower(subject, audience keyline.Node) keyline.Power {
	q.t.Helper()
	return readTest(q.t, q.store, func(tx keyline.ReadTx) (keyline.Power, error) {
		return keyline.EffectivePower(q.t.Context(), tx, subject, audience)
	})
}

func (q testQueries) IsLive(id keyline.ID) bool {
	q.t.Helper()
	return readTest(q.t, q.store, func(tx keyline.ReadTx) (bool, error) {
		return keyline.IsLive(q.t.Context(), tx, id)
	})
}

func (q testQueries) Members(subject keyline.Node) map[keyline.Node]keyline.Power {
	q.t.Helper()
	return members(q.t, q.store, subject)
}

func readTest[T any](t *testing.T, store keyline.Store, fn func(keyline.ReadTx) (T, error)) T {
	t.Helper()
	var value T

	require.NoError(t, store.View(t.Context(), func(tx keyline.ReadTx) error {
		var err error

		value, err = fn(tx)
		return err
	}))
	return value
}

func readDigest(t *testing.T, store keyline.Store) [32]byte {
	t.Helper()
	return readTest(t, store, func(tx keyline.ReadTx) ([32]byte, error) { return keyline.Digest(t.Context(), tx) })
}

func readClosure(t *testing.T, store keyline.Store, subject keyline.Node) keyline.Batch {
	t.Helper()
	return readTest(t, store, func(tx keyline.ReadTx) (keyline.Batch, error) {
		return keyline.Collect(keyline.Closure(t.Context(), tx, subject))
	})
}

func collectEnumeration[T any](t *testing.T, rows iter.Seq2[T, error]) []T {
	t.Helper()
	var result []T

	for value, err := range rows {
		require.NoError(t, err)
		result = append(result, value)
	}

	return result
}
