package docmodel

import (
	"math"
	"reflect"
	"slices"

	"seed/backend/blob"
)

// Equality used to decide whether a mutation changes the committed state.
//
// Comparing the incoming value with the committed one using reflect.DeepEqual
// is not enough, because the two sides are produced by different decoders:
//
//   - The committed state is decoded from CBOR, where integers inside
//     untyped values arrive as plain int (see blob/blob_change_ops.go),
//     and an explicit empty array decodes to a non-nil empty slice.
//   - The incoming value is converted from protobuf, where whole numbers
//     become int64 (see valueAsInterface and the SetAttribute int_value),
//     and empty repeated fields are nil slices.
//
// So the same logical value would never compare equal after a round trip
// through the blob store, and identical mutations would be re-emitted forever.
//
// The functions here compare values by what they mean, not by their Go types.
// They are only used for comparison: values are still stored exactly
// as the caller provided them, so the encoding of new blobs doesn't change.

// blocksEqual reports whether two blocks have the same logical content.
//
// Fields that are absent and fields that are explicitly empty are the same:
// our API can't express the difference (reading such a block and writing it back
// is otherwise never a no-op), and our own encoding omits empty fields anyway.
func blocksEqual(a, b blob.Block) bool {
	return a.ID() == b.ID() &&
		a.Type == b.Type &&
		a.Text == b.Text &&
		a.Link == b.Link &&
		attrMapsEqual(a.Attributes(), b.Attributes()) &&
		slices.EqualFunc(a.Annotations, b.Annotations, annotationsEqual)
}

func annotationsEqual(a, b blob.Annotation) bool {
	return a.Type == b.Type &&
		a.Link == b.Link &&
		attrMapsEqual(a.Attributes(), b.Attributes()) &&
		slices.Equal(a.Starts, b.Starts) &&
		slices.Equal(a.Ends, b.Ends)
}

// attrMapsEqual compares maps of attributes. Nil and empty maps are equal,
// but a key holding a nil value is different from a missing key,
// because those are distinct in the stored data and are exposed as such.
func attrMapsEqual(a, b map[string]any) bool {
	if len(a) != len(b) {
		return false
	}

	for k, av := range a {
		bv, ok := b[k]
		if !ok || !attrValuesEqual(av, bv) {
			return false
		}
	}

	return true
}

// attrValuesEqual compares two attribute values,
// ignoring the differences in how Go represents the same number.
func attrValuesEqual(a, b any) bool {
	if an, ok := normalizeNumber(a); ok {
		bn, ok := normalizeNumber(b)
		return ok && an == bn
	}

	switch av := a.(type) {
	case map[string]any:
		bv, ok := b.(map[string]any)
		return ok && attrMapsEqual(av, bv)
	case []any:
		bv, ok := b.([]any)
		return ok && slices.EqualFunc(av, bv, attrValuesEqual)
	default:
		return reflect.DeepEqual(a, b)
	}
}

// normalizeNumber converts any numeric value into a canonical representation:
// int64 for whole numbers that fit, the same rule valueAsInterface applies
// to numbers coming from protobuf, and uint64 or float64 for everything else.
func normalizeNumber(v any) (n any, ok bool) {
	switch vv := v.(type) {
	case int:
		return int64(vv), true
	case int8:
		return int64(vv), true
	case int16:
		return int64(vv), true
	case int32:
		return int64(vv), true
	case int64:
		return vv, true
	case uint:
		return normalizeUint(uint64(vv)), true
	case uint8:
		return int64(vv), true
	case uint16:
		return int64(vv), true
	case uint32:
		return int64(vv), true
	case uint64:
		return normalizeUint(vv), true
	case float32:
		return normalizeFloat(float64(vv)), true
	case float64:
		return normalizeFloat(vv), true
	default:
		return nil, false
	}
}

func normalizeUint(v uint64) any {
	if v > math.MaxInt64 {
		return v
	}

	return int64(v)
}

func normalizeFloat(v float64) any {
	// Both bounds are exactly representable as float64. The upper one is exclusive,
	// because 2^63 itself overflows int64. NaN fails the range check and is returned
	// as is, so it never equals anything, which is what we want for change detection.
	if v >= -(1<<63) && v < 1<<63 {
		if n := int64(v); float64(n) == v {
			return n
		}
	}

	return v
}
