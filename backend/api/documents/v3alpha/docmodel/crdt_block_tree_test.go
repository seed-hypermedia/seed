package docmodel

import (
	"seed/backend/util/must"
	"slices"
	"testing"
	"time"

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
	gotTree := slices.Collect(opset.State().DFT(""))
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
		gotTree := slices.Collect(opset.State().DFT(""))
		require.Equal(t, wantTree, gotTree, "tree after second set of moves must match")
	}
}

// TestSelfParentDoesNotHang reproduces the production incident where a document
// contained a block that was its own parent (a MoveBlocks op with block ==
// parent that slipped past the integration guard). Rebuilding the tree state
// used to loop forever in isAncestor, hanging hydration and pinning a CPU core.
// State() must terminate and treat the self-parent move as invisible.
func TestSelfParentDoesNotHang(t *testing.T) {
	opset := newTreeOpSet()
	// Place X validly at the root first, so it exists with a sublist.
	require.NoError(t, opset.Integrate(newOpID(1, 0, 0), "", "X", opID{}))
	// Corrupt move: X under itself. Integrate only appends to the log — the
	// cycle check lives in State()/Move — so this mirrors historical data.
	require.NoError(t, opset.Integrate(newOpID(2, 0, 1), "X", "X", opID{}))

	done := make(chan *blockTreeState, 1)
	go func() { done <- opset.State() }()

	select {
	case state := <-done:
		// The self-parent move must have been rejected: X stays at the root.
		require.Equal(t, "", state.blocks["X"].Parent, "self-parent move must be ignored; X must remain at root")
		require.Equal(t, []blockPair{{"", "X"}}, slices.Collect(state.DFT("")))
	case <-time.After(10 * time.Second):
		t.Fatal("State() did not terminate: self-parent cycle guard failed")
	}
}

// TestIsAncestorTerminatesOnCycle directly exercises the bounded walk against a
// corrupt block graph (both a self-loop and a two-node cycle). It must return
// rather than loop forever.
func TestIsAncestorTerminatesOnCycle(t *testing.T) {
	state := &blockTreeState{blocks: map[string]blockState{
		"X": {Parent: "X"}, // self-loop
		"A": {Parent: "B"}, // A <-> B cycle
		"B": {Parent: "A"},
	}}
	require.False(t, state.isAncestor("Z", "X"), "self-loop must terminate as not-an-ancestor")
	require.False(t, state.isAncestor("Z", "A"), "two-node cycle must terminate as not-an-ancestor")
}

// TestMoveBlockRejectsSelfParent verifies the write path refuses to create a
// self-parent move in the first place.
func TestMoveBlockRejectsSelfParent(t *testing.T) {
	opset := newTreeOpSet()
	mut := opset.State().Mutate()
	must.Do2(mut.Move("", "X", ""))
	_, err := mut.Move("X", "X", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "its own parent")
}
