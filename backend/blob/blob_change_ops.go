package blob

import (
	"errors"
	"fmt"
)

// Decoding ops out of their map representation.
//
// Ops are a union type discriminated by an inlined "type" field: every variant
// flattens its own fields into the same map, instead of nesting them under a
// variant key. refmt/atlas can't express that (its union support requires a
// keyed envelope), and we don't know all the possible Block/Annotation fields
// in advance anyway, so changes carry their ops as opaque maps (OpMap) and we
// convert them to concrete types on demand.
//
// That conversion used to borrow the CBOR codec as a generic map-to-struct
// converter: encode the map back into CBOR bytes, then decode those bytes into
// the variant struct (see mapToCBORReference in the tests). It worked because
// the codec gave us four things for free -- refmt tag mapping, flattening of
// the embedded baseOp, dispatch to the registered Block/Annotation transforms,
// and type coercion -- but it paid a full serialize/deserialize round-trip per
// op, on data that had just been decoded from CBOR moments earlier. In a
// production profile that round-trip was ~13% of all daemon CPU and the largest
// single source of garbage, because every op of every change of every document
// replay went through it.
//
// The functions below do the conversion directly. They deliberately mirror
// refmt's decoding rules, because the maps they consume were produced by
// refmt's wildcard decoder and the results must match what the codec produced
// before:
//
//   - CBOR integers arrive as plain int: obj.unmarshalMachinePrimitive uses int
//     for both TInt and TUint when the target is interface{}.
//   - CBOR arrays arrive as []any, maps as map[string]any, byte strings as []byte.
//   - Decoding an array into a typed slice yields a non-nil empty slice for [],
//     and a nil slice for null (obj.unmarshalMachineSliceWildcard).
//   - Unsigned fields reject negative values.
//   - Unknown fields are an error: refmt is strict and returns ErrNoSuchField
//     rather than skipping them.
//
// Block and Annotation are deliberately not hand-decoded here. They have no
// fixed schema -- that's what the ",remain" mapstructure tag is for, plus the
// legacy "iD" and nested "attributes" encodings we have to support forever --
// so they keep going through mapstruct, which is the very function their atlas
// transforms call. Their behaviour is therefore unchanged.

// errUnknownOpField is returned for a map key that doesn't correspond to any
// field of the target op.
//
// We reject unknown fields instead of skipping them, matching refmt's
// ErrNoSuchField: silently dropping a field we don't understand would render a
// newer op format as a subtly wrong document instead of failing loudly.
var errUnknownOpField = errors.New("unknown field for op type")

// errWrongValueType is returned when a map value can't fit the field it's
// destined for, mirroring refmt's ErrUnmarshalTypeCantFit.
var errWrongValueType = errors.New("unexpected value type")

func opFieldError(t OpType, field string, v any, err error) error {
	return fmt.Errorf("op %s: field %q (%T): %w", t, field, v, err)
}

// opString extracts a string field. refmt only accepts CBOR text strings for
// string fields, so neither do we.
func opString(v any) (string, error) {
	s, ok := v.(string)
	if !ok {
		return "", errWrongValueType
	}
	return s, nil
}

// opStringSlice extracts a []string field. A null value decodes to a nil slice
// and an empty array to a non-nil empty slice, matching refmt.
func opStringSlice(v any) ([]string, error) {
	if v == nil {
		return nil, nil
	}

	items, ok := v.([]any)
	if !ok {
		return nil, errWrongValueType
	}

	out := make([]string, len(items))
	for i, item := range items {
		s, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("element %d: %w", i, errWrongValueType)
		}
		out[i] = s
	}

	return out, nil
}

// opUint64 extracts an unsigned integer.
//
// refmt's wildcard decoder always yields plain int, so that's the case that
// matters in production. The wider integer types are accepted because an OpMap
// can also be built in-process, and the old CBOR round-trip would have accepted
// them too: marshalling an int64 emits the same token an int does.
func opUint64(v any) (uint64, error) {
	switch n := v.(type) {
	case int:
		if n < 0 {
			return 0, fmt.Errorf("negative value %d in unsigned field: %w", n, errWrongValueType)
		}
		return uint64(n), nil
	case int64:
		if n < 0 {
			return 0, fmt.Errorf("negative value %d in unsigned field: %w", n, errWrongValueType)
		}
		return uint64(n), nil
	case uint:
		return uint64(n), nil
	case uint64:
		return n, nil
	default:
		return 0, errWrongValueType
	}
}

// opUint64Slice extracts a []uint64 field, with the same nil/empty distinction
// as opStringSlice.
func opUint64Slice(v any) ([]uint64, error) {
	if v == nil {
		return nil, nil
	}

	items, ok := v.([]any)
	if !ok {
		return nil, errWrongValueType
	}

	out := make([]uint64, len(items))
	for i, item := range items {
		n, err := opUint64(item)
		if err != nil {
			return nil, fmt.Errorf("element %d: %w", i, err)
		}
		out[i] = n
	}

	return out, nil
}

// opBlock extracts a Block field, using the same mapstruct call that Block's
// registered atlas transform uses.
func opBlock(v any) (Block, error) {
	var out Block
	if v == nil {
		return out, nil
	}

	m, ok := v.(map[string]any)
	if !ok {
		return out, errWrongValueType
	}

	if err := mapstruct(m, &out); err != nil {
		return out, err
	}

	return out, nil
}

// opKeyValues extracts a []KeyValue field.
func opKeyValues(v any) ([]KeyValue, error) {
	if v == nil {
		return nil, nil
	}

	items, ok := v.([]any)
	if !ok {
		return nil, errWrongValueType
	}

	out := make([]KeyValue, len(items))
	for i, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("element %d: %w", i, errWrongValueType)
		}

		var kv KeyValue
		for k, vv := range m {
			var err error
			switch k {
			case "key":
				kv.Key, err = opStringSlice(vv)
			case "value":
				kv.Value = vv
			default:
				err = errUnknownOpField
			}
			if err != nil {
				return nil, fmt.Errorf("element %d: field %q (%T): %w", i, k, vv, err)
			}
		}
		out[i] = kv
	}

	return out, nil
}

func opSetKeyFromMap(o OpMap) (Op, error) {
	out := OpSetKey{baseOp: baseOp{Type: OpTypeSetKey}}
	for k, v := range o {
		var err error
		switch k {
		case "type": // The discriminator, already consumed by ToOp.
		case "key":
			out.Key, err = opString(v)
		case "value":
			// Untyped field: it passes through exactly as the wildcard decoder
			// left it, which is what the round-trip did too.
			out.Value = v
		default:
			err = errUnknownOpField
		}
		if err != nil {
			return nil, opFieldError(OpTypeSetKey, k, v, err)
		}
	}
	return out, nil
}

func opSetAttributesFromMap(o OpMap) (Op, error) {
	out := OpSetAttributes{baseOp: baseOp{Type: OpTypeSetAttributes}}
	for k, v := range o {
		var err error
		switch k {
		case "type":
		case "block":
			// Note: unlike OpReplaceBlock, this "block" is just an ID.
			out.Block, err = opString(v)
		case "attrs":
			out.Attrs, err = opKeyValues(v)
		default:
			err = errUnknownOpField
		}
		if err != nil {
			return nil, opFieldError(OpTypeSetAttributes, k, v, err)
		}
	}
	return out, nil
}

func opMoveBlocksFromMap(o OpMap) (Op, error) {
	out := OpMoveBlocks{baseOp: baseOp{Type: OpTypeMoveBlocks}}
	for k, v := range o {
		var err error
		switch k {
		case "type":
		case "parent":
			out.Parent, err = opString(v)
		case "blocks":
			out.Blocks, err = opStringSlice(v)
		case "ref":
			out.Ref, err = opUint64Slice(v)
		default:
			err = errUnknownOpField
		}
		if err != nil {
			return nil, opFieldError(OpTypeMoveBlocks, k, v, err)
		}
	}
	return out, nil
}

func opReplaceBlockFromMap(o OpMap) (Op, error) {
	out := OpReplaceBlock{baseOp: baseOp{Type: OpTypeReplaceBlock}}
	for k, v := range o {
		var err error
		switch k {
		case "type":
		case "block":
			out.Block, err = opBlock(v)
		default:
			err = errUnknownOpField
		}
		if err != nil {
			return nil, opFieldError(OpTypeReplaceBlock, k, v, err)
		}
	}
	return out, nil
}

func opDeleteBlocksFromMap(o OpMap) (Op, error) {
	out := OpDeleteBlocks{baseOp: baseOp{Type: OpTypeDeleteBlocks}}
	for k, v := range o {
		var err error
		switch k {
		case "type":
		case "blocks":
			out.Blocks, err = opStringSlice(v)
		default:
			err = errUnknownOpField
		}
		if err != nil {
			return nil, opFieldError(OpTypeDeleteBlocks, k, v, err)
		}
	}
	return out, nil
}
