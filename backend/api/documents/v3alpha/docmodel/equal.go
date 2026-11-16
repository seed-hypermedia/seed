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

// blocksEqual reports whether the committed block has the same logical content
// as the incoming one, i.e. whether writing the incoming block would be a no-op.
//
// Fields that are absent and fields that are explicitly empty are the same:
// our API can't express the difference (reading such a block and writing it back
// is otherwise never a no-op), and our own encoding omits empty fields anyway.
//
// The arguments are not interchangeable: a committed block in an ambiguous
// legacy encoding is never equal to anything, see hasAmbiguousAttrs.
func blocksEqual(committed, incoming blob.Block) bool {
	return !hasAmbiguousAttrs(committed.Attributes_Old, committed.InlineAttributes_) &&
		committed.ID() == incoming.ID() &&
		committed.Type == incoming.Type &&
		committed.Text == incoming.Text &&
		committed.Link == incoming.Link &&
		attrMapsEqual(committed.Attributes(), incoming.Attributes()) &&
		slices.EqualFunc(committed.Annotations, incoming.Annotations, annotationsEqual)
}

func annotationsEqual(committed, incoming blob.Annotation) bool {
	return !hasAmbiguousAttrs(committed.Attributes_Old, committed.InlineAttributes_) &&
		committed.Type == incoming.Type &&
		committed.Link == incoming.Link &&
		attrMapsEqual(committed.Attributes(), incoming.Attributes()) &&
		slices.Equal(committed.Starts, incoming.Starts) &&
		slices.Equal(committed.Ends, incoming.Ends)
}

// hasAmbiguousAttrs reports whether a committed value carries both the legacy
// nested "attributes" map and inline attributes. Attributes() only returns
// the legacy map in that case, so the inline ones are invisible to readers,
// and a write that looks identical must still be emitted: it replaces the value
// with one in the current encoding, where nothing is hidden.
func hasAmbiguousAttrs(legacy, inline map[string]any) bool {
	return len(legacy) > 0 && len(inline) > 0
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
// int64 for whole numbers that fit, and uint64 or float64 for everything else.
//
// This is close to what valueAsInterface does to numbers coming from protobuf,
// but not the same: valueAsInterface converts to int64 without a range check,
// so the result for floats outside of the int64 range is platform-dependent
// (2^63 saturates to MaxInt64 on arm64), and it turns negative zero into 0.
// Here the range is checked, and negative zero stays a float.
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
	// Negative zero is not the integer 0: it's a distinct value in the stored data,
	// so replacing 0 with -0.0 (or the other way around) must remain a change.
	if v == 0 && math.Signbit(v) {
		return v
	}

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
