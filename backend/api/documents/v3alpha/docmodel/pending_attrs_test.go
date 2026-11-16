package docmodel

import (
	"fmt"
	"math/rand"
	"slices"
	"strings"
	"testing"

	"seed/backend/blob"
	"seed/backend/core/coretest"
	"seed/backend/util/cclock"
	"seed/backend/util/must"

	"github.com/stretchr/testify/require"
)

type attrWrite struct {
	Key   []string
	Value any
}

func set(value any, key ...string) attrWrite {
	return attrWrite{Key: key, Value: value}
}

// Document attributes are per key path, and a write to a key replaces whatever
// is stored above and below it. Writes of one request apply in the request order,
// so each of them must be compared with what the earlier writes of the same
// request leave behind, not only with the committed state.
func TestSetAttribute_PendingWrites(t *testing.T) {
	sourceMap := []attrWrite{
		set("x", "source", "type"),
		set("1", "source", "a"),
		set("2", "source", "b"),
	}

	cases := map[string]struct {
		initial []attrWrite
		request []attrWrite
		want    map[string]any
		// Number of attribute writes that must be stored.
		wantOps int
	}{
		"reported: clear, then set some of the entries the map already has": {
			initial: sourceMap,
			request: []attrWrite{
				set(nil, "source"),
				set("x", "source", "type"),
				set("1", "source", "a"),
			},
			want:    map[string]any{"source": map[string]any{"type": "x", "a": "1"}},
			wantOps: 1,
		},
		"clear, then set every entry the map already has": {
			initial: sourceMap,
			request: []attrWrite{
				set(nil, "source"),
				set("x", "source", "type"),
				set("1", "source", "a"),
				set("2", "source", "b"),
			},
			want:    map[string]any{"source": map[string]any{"type": "x", "a": "1", "b": "2"}},
			wantOps: 0,
		},
		"clear, then set changed and new entries": {
			initial: sourceMap,
			request: []attrWrite{
				set(nil, "source"),
				set("y", "source", "type"),
				set("3", "source", "c"),
			},
			want:    map[string]any{"source": map[string]any{"type": "y", "c": "3"}},
			wantOps: 3,
		},
		"clear, then set one changed entry": {
			initial: sourceMap,
			request: []attrWrite{
				set(nil, "source"),
				set("x", "source", "type"),
				set("1", "source", "a"),
				set("9", "source", "b"),
			},
			want:    map[string]any{"source": map[string]any{"type": "x", "a": "1", "b": "9"}},
			wantOps: 1,
		},
		"clear only": {
			initial: sourceMap,
			request: []attrWrite{set(nil, "source")},
			want:    map[string]any{},
			wantOps: 1,
		},
		"set entries, then clear the parent": {
			initial: sourceMap,
			request: []attrWrite{
				set("y", "source", "type"),
				set("3", "source", "c"),
				set(nil, "source"),
			},
			want:    map[string]any{},
			wantOps: 1,
		},
		"set unchanged entries, then clear the parent": {
			initial: sourceMap,
			request: []attrWrite{
				set("x", "source", "type"),
				set(nil, "source"),
			},
			want:    map[string]any{},
			wantOps: 1,
		},
		"clear, set entries, clear again": {
			initial: sourceMap,
			request: []attrWrite{
				set(nil, "source"),
				set("x", "source", "type"),
				set(nil, "source"),
			},
			want:    map[string]any{},
			wantOps: 1,
		},
		"scalar at a key that holds a map": {
			initial: sourceMap,
			request: []attrWrite{set("s", "source")},
			want:    map[string]any{"source": "s"},
			wantOps: 1,
		},
		"scalar at a key that holds a map, then an entry the map had": {
			initial: sourceMap,
			request: []attrWrite{
				set("s", "source"),
				set("1", "source", "a"),
			},
			want:    map[string]any{"source": map[string]any{"a": "1"}},
			wantOps: 2,
		},
		"entry of a map, then a scalar at the key": {
			initial: sourceMap,
			request: []attrWrite{
				set("9", "source", "a"),
				set("s", "source"),
			},
			want:    map[string]any{"source": "s"},
			wantOps: 1,
		},
		"map entry under a key that holds a scalar": {
			initial: []attrWrite{set("s", "source")},
			request: []attrWrite{set("1", "source", "a")},
			want:    map[string]any{"source": map[string]any{"a": "1"}},
			wantOps: 1,
		},
		"map entry under a key that holds a scalar, then the same scalar again": {
			initial: []attrWrite{set("s", "source")},
			request: []attrWrite{
				set("1", "source", "a"),
				set("s", "source"),
			},
			want:    map[string]any{"source": "s"},
			wantOps: 0,
		},
		"clear a scalar, then set a map entry": {
			initial: []attrWrite{set("s", "source")},
			request: []attrWrite{
				set(nil, "source"),
				set("1", "source", "a"),
			},
			want:    map[string]any{"source": map[string]any{"a": "1"}},
			wantOps: 1,
		},
		"same scalar again, then a map entry under it": {
			initial: []attrWrite{set("s", "source")},
			request: []attrWrite{
				set("s", "source"),
				set("1", "source", "a"),
			},
			want:    map[string]any{"source": map[string]any{"a": "1"}},
			wantOps: 1,
		},
		"clear a nested map, then set some of what it has": {
			initial: []attrWrite{
				set("1", "source", "x", "y"),
				set("2", "source", "x", "z"),
				set("3", "source", "k"),
			},
			request: []attrWrite{
				set(nil, "source"),
				set("3", "source", "k"),
				set("1", "source", "x", "y"),
			},
			want:    map[string]any{"source": map[string]any{"k": "3", "x": map[string]any{"y": "1"}}},
			wantOps: 1,
		},
		"clear a map, then replace a nested map by a scalar": {
			initial: []attrWrite{
				set("1", "source", "x", "y"),
				set("2", "source", "x", "z"),
				set("3", "source", "k"),
			},
			request: []attrWrite{
				set(nil, "source"),
				set("3", "source", "k"),
				set("s", "source", "x"),
			},
			want:    map[string]any{"source": map[string]any{"k": "3", "x": "s"}},
			wantOps: 1,
		},
		"clear the outer and the inner map, then set some of the inner entries": {
			initial: []attrWrite{
				set("1", "source", "x", "y"),
				set("2", "source", "x", "z"),
				set("3", "source", "k"),
			},
			request: []attrWrite{
				set(nil, "source"),
				set("3", "source", "k"),
				set(nil, "source", "x"),
				set("1", "source", "x", "y"),
			},
			want:    map[string]any{"source": map[string]any{"k": "3", "x": map[string]any{"y": "1"}}},
			wantOps: 1,
		},
		"clear a map that doesn't exist, then set entries": {
			initial: []attrWrite{set("Hello", "title")},
			request: []attrWrite{
				set(nil, "source"),
				set("x", "source", "type"),
			},
			want:    map[string]any{"title": "Hello", "source": map[string]any{"type": "x"}},
			wantOps: 1,
		},
		"other keys are not affected": {
			initial: append([]attrWrite{set("Hello", "title"), set("v", "sourcemap", "k")}, sourceMap...),
			request: []attrWrite{
				set(nil, "source"),
				set("x", "source", "type"),
			},
			want: map[string]any{
				"title":     "Hello",
				"sourcemap": map[string]any{"k": "v"},
				"source":    map[string]any{"type": "x"},
			},
			wantOps: 2,
		},
	}

	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			alice := coretest.NewTester("alice").Account

			doc := must.Do2(New("mydoc", cclock.New()))
			must.Do(doc.SetAttribute("", []string{"seed"}, "1"))
			for _, w := range tc.initial {
				must.Do(doc.SetAttribute("", w.Key, w.Value))
			}

			c1 := must.Do2(doc.SignChange(alice))

			apply := func(doc *Document) {
				for _, w := range tc.request {
					must.Do(doc.SetAttribute("", w.Key, w.Value))
				}
			}

			doc = loadFromBytes(t, c1)
			apply(doc)
			c2 := must.Do2(doc.SignChange(alice))

			want := map[string]any{"seed": "1"}
			for k, v := range tc.want {
				want[k] = v
			}

			stored := storedAttrs(t, c2)
			require.Equal(t, want, loadFromBytes(t, c1, c2).crdt.GetMetadata(), "metadata read back after applying the change (stored=%v)", stored)
			require.Len(t, stored, tc.wantOps, "stored attribute writes: %v", stored)

			// The same request on top of its own result must not store anything.
			doc = loadFromBytes(t, c1, c2)
			apply(doc)
			c3 := must.Do2(doc.SignChange(alice))
			require.Equal(t, want, loadFromBytes(t, c1, c2, c3).crdt.GetMetadata(), "metadata read back after repeating the request")
			require.Empty(t, c3.Decoded.Body.Ops, "repeating the request must produce no ops")
		})
	}
}

// TestSetAttribute_Random applies random requests and compares what is read back
// with a trivial model: writes apply one by one, in the request order,
// each of them removing whatever is above and below its key.
func TestSetAttribute_Random(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	names := []string{"a", "b", "c"}
	values := []any{nil, nil, "1", "2", true, int64(7)}

	for seed := range 2000 {
		rng := rand.New(rand.NewSource(int64(seed))) //nolint:gosec // Deterministic test input.

		model := map[string]any{}
		write := func(key []string, value any) {
			joined := strings.Join(key, ".")
			for k := range model {
				if strings.HasPrefix(k, joined+".") || strings.HasPrefix(joined, k+".") {
					delete(model, k)
				}
			}

			model[joined] = value
		}
		want := func() map[string]any {
			out := map[string]any{}
			for k, v := range model {
				if v == nil {
					continue
				}

				cur := out
				path := strings.Split(k, ".")
				for _, p := range path[:len(path)-1] {
					next, ok := cur[p].(map[string]any)
					if !ok {
						next = map[string]any{}
						cur[p] = next
					}

					cur = next
				}

				cur[path[len(path)-1]] = v
			}

			return out
		}

		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.SetAttribute("", []string{"seed"}, "1"))
		write([]string{"seed"}, "1")
		changes := []blob.Encoded[*blob.Change]{must.Do2(doc.SignChange(alice))}

		for round := range 4 {
			var request []attrWrite

			for range 1 + rng.Intn(6) {
				key := make([]string, 1+rng.Intn(3))
				for i := range key {
					key[i] = names[rng.Intn(len(names))]
				}

				request = append(request, set(values[rng.Intn(len(values))], key...))
			}

			info := fmt.Sprintf("seed=%d round=%d before=%v request=%v", seed, round, loadFromBytes(t, changes...).crdt.GetMetadata(), request)

			doc := loadFromBytes(t, changes...)
			for _, w := range request {
				must.Do(doc.SetAttribute("", w.Key, w.Value))
				write(w.Key, w.Value)
			}

			ch := must.Do2(doc.SignChange(alice))
			changes = append(changes, ch)

			stored := storedAttrs(t, ch)
			require.Equal(t, want(), normalizeInts(loadFromBytes(t, changes...).crdt.GetMetadata()), "%s stored=%v", info, stored)
			require.LessOrEqual(t, len(stored), len(request), "%s stored=%v", info, stored)
			require.True(t, slices.IsSortedFunc(stored, func(a, b blob.KeyValue) int { return slices.Compare(a.Key, b.Key) }), "%s stored=%v", info, stored)

			// The same request on top of its own result must not store anything.
			doc = loadFromBytes(t, changes...)
			for _, w := range request {
				must.Do(doc.SetAttribute("", w.Key, w.Value))
			}

			again := must.Do2(doc.SignChange(alice))
			require.Empty(t, again.Decoded.Body.Ops, "%s: repeating the request must produce no ops", info)
		}
	}
}

// normalizeInts undoes the int64 -> int conversion of the CBOR round trip.
func normalizeInts(in map[string]any) map[string]any {
	for k, v := range in {
		switch vv := v.(type) {
		case int:
			in[k] = int64(vv)
		case map[string]any:
			normalizeInts(vv)
		}
	}

	return in
}

func storedAttrs(t *testing.T, c blob.Encoded[*blob.Change]) (out []blob.KeyValue) {
	t.Helper()

	for op, err := range loadedChange(t, c).Ops() {
		require.NoError(t, err)

		if op, ok := op.(blob.OpSetAttributes); ok {
			out = append(out, op.Attrs...)
		}
	}

	return out
}
