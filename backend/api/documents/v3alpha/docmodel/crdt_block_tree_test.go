package docmodel

import (
	"seed/backend/util/must"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCRDTBlockTree_Smoke(t *testing.T) {
	opset := newTreeOpSet()

	mut := opset.State().Mutate()
	require.Equal(t, moveEffectCreated, must.Do2(mut.Move("", "b1", "")))
	require.Equal(t, moveEffectCreated, must.Do2(mut.Move("", "b2", "b1")))
	require.Equal(t, moveEffectCreated, must.Do2(mut.Move("", "b3", "b2")))
	require.Equal(t, moveEffectCreated, must.Do2(mut.Move("b1", "b1.1", "")))
	require.Equal(t, moveEffectCreated, must.Do2(mut.Move("b1", "b1.0", "")))
	require.Equal(t, moveEffectMoved, must.Do2(mut.Move("b1", "b2", "b1.1")))
	require.Equal(t, moveEffectMoved, must.Do2(mut.Move("b1", "b2", "b1.0")))
	require.Equal(t, moveEffectMoved, must.Do2(mut.Move("b1", "b2", "b1.1")))

	/*
		- b1
		  - b1.0
		  - b1.1
		  - b2
		- b3
	*/

	wantOps := []moveRecord{
		{OpID: newOpID(12345, 123, 0), Parent: "", Block: "b1", Ref: opID{}},
		{OpID: newOpID(12345, 123, 1), Parent: "", Block: "b3", Ref: newOpID(12345, 123, 0)},
		{OpID: newOpID(12345, 123, 2), Parent: "b1", Block: "b1.0", Ref: opID{}},
		{OpID: newOpID(12345, 123, 3), Parent: "b1", Block: "b1.1", Ref: newOpID(12345, 123, 2)},
		{OpID: newOpID(12345, 123, 4), Parent: "b1", Block: "b2", Ref: newOpID(12345, 123, 3)},
	}

	gotOps := slices.Collect(mut.Commit(12345, 123))

	require.Equal(t, wantOps, gotOps, "committed mutation moves must match")

	require.Equal(t, 0, opset.log.Len(), "mutation must operate on a copy of opset")
	for _, children := range opset.sublists.Items() {
		require.Equal(t, 0, children.items.Len(), "mutation must operate on a copy of opset")
	}

	// Apply committed ops to the original state.
	for _, op := range gotOps {
		require.NoError(t, opset.Integrate(op.OpID, op.Parent, op.Block, op.Ref))
	}

	wantTree := []blockPair{
		{"", "b1"},
		{"b1", "b1.0"},
		{"b1", "b1.1"},
		{"b1", "b2"},
		{"", "b3"},
	}
	gotTree := slices.Collect(opset.State().DFT())
	require.Equal(t, wantTree, gotTree, "tree after first set of moves must match")

	{
		/*
			- b3
			- b1
			  - b1.0
			  - b1.2
			  - b1.1
		*/

		mut := opset.State().Mutate()
		require.Equal(t, moveEffectCreated, must.Do2(mut.Move("b1", "b1.2", "b1.0")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move("", "b3", "")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move(TrashNodeID, "b2", "")))
		require.Equal(t, moveEffectCreated, must.Do2(mut.Move("", "b4", "")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move("", "b4", "b3")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move("b1", "b4", "b1.2")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move("b1", "b4", "b1.1")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move(TrashNodeID, "b4", "")))

		// // Move around the existing node and put it back in the same logical place.
		// // This should not create new moves.
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move(TrashNodeID, "b1.0", "")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move("", "b1.0", "")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move("", "b1.0", "b1")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move("", "b1.0", "b3")))
		require.Equal(t, moveEffectMoved, must.Do2(mut.Move("b1", "b1.0", "")))

		wantOps := []moveRecord{
			{OpID: newOpID(12346, 1, 0), Parent: "", Block: "b3", Ref: opID{}},
			{OpID: newOpID(12346, 1, 1), Parent: "b1", Block: "b1.2", Ref: newOpID(12345, 123, 2)},
			{OpID: newOpID(12346, 1, 2), Parent: TrashNodeID, Block: "b2", Ref: opID{}},
		}

		gotOps := slices.Collect(mut.Commit(12346, 1))

		// _ = wantOps
		// _ = gotOps
		require.Equal(t, wantOps, gotOps, "committed mutation moves must match")

		for _, op := range gotOps {
			require.NoError(t, opset.Integrate(op.OpID, op.Parent, op.Block, op.Ref))
		}

		wantTree := []blockPair{
			{"", "b3"},
			{"", "b1"},
			{"b1", "b1.0"},
			{"b1", "b1.2"},
			{"b1", "b1.1"},
		}
		gotTree := slices.Collect(opset.State().DFT())
		require.Equal(t, wantTree, gotTree, "tree after second set of moves must match")
	}
}
