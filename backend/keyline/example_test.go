package keyline_test

import (
	"context"
	"fmt"

	"seed/backend/keyline"
	"seed/backend/keyline/keylinemem"
)

// Copy one subject's authority closure to a partial replica. The replica can
// answer for that subject but receives nothing about unrelated subjects.
func ExampleClosure() {
	ctx := context.Background()
	source := &keylinemem.Store{}

	_, err := source.Apply(ctx, keyline.Batch{Delegations: []keyline.Delegation{
		{ID: "notes-owner", Issuer: "notes", Audience: "alice", Subject: "notes", Power: keyline.Admin, BlobID: 1},
		{ID: "notes-bob", Issuer: "alice", Audience: "bob", Subject: "notes", Power: keyline.Write, BlobID: 2},
		{ID: "drafts-owner", Issuer: "drafts", Audience: "alice", Subject: "drafts", Power: keyline.Admin, BlobID: 3},
	}})
	if err != nil {
		panic(err)
	}

	var batch keyline.Batch

	err = source.View(ctx, func(tx keyline.ReadTx) error {
		var err error

		batch, err = keyline.Collect(keyline.Closure(ctx, tx, "notes"))
		return err
	})
	if err != nil {
		panic(err)
	}

	// Both stores share one blob namespace here. Across databases, authenticate
	// the records and assign receiver-local BlobIDs before Apply.
	replica := &keylinemem.Store{}
	if _, err := replica.Apply(ctx, batch); err != nil {
		panic(err)
	}

	err = replica.View(ctx, func(tx keyline.ReadTx) error {
		for _, subject := range []keyline.Node{"notes", "drafts"} {
			power, err := keyline.EffectivePower(ctx, tx, subject, "alice")
			if err != nil {
				return err
			}

			fmt.Println(subject, power)
		}

		return nil
	})
	if err != nil {
		panic(err)
	}

	// Output:
	// notes admin
	// drafts none
}

func Example_rotation() {
	ctx := context.Background()
	store := &keylinemem.Store{}

	_, err := store.Apply(ctx, keyline.Batch{Delegations: []keyline.Delegation{
		{"supply", "doc", "officers", "doc", keyline.Write, 1},
		{"alice", "officers", "alice", "officers", keyline.Admin, 2},
		{"bob", "officers", "bob", "officers", keyline.Admin, 3},
		{"carol", "bob", "carol", "doc", keyline.Write, 4},
	}})
	if err != nil {
		panic(err)
	}

	// The caller authenticates these facts and chooses every fresh identity.
	// Keep Bob, omit Alice, and atomically replace the role's supply and roster.
	_, err = store.Apply(ctx, keyline.Batch{
		Nodes: []keyline.NodeRecord{{"officers-next", 5, 0, "next-blob"}},
		Delegations: []keyline.Delegation{
			{"next-supply", "doc", "officers-next", "doc", keyline.Write, 6},
			{"next-bob", "officers-next", "bob", "officers-next", keyline.Admin, 7},
		},
		Revocations: []keyline.Revocation{{"retire-supply", "doc", "supply", 8}},
	})
	if err != nil {
		panic(err)
	}

	err = store.View(ctx, func(tx keyline.ReadTx) error {
		for _, member := range []keyline.Node{"bob", "alice", "carol"} {
			allowed, err := keyline.Allows(ctx, tx, "doc", member, keyline.Write)
			if err != nil {
				return err
			}

			fmt.Println(member, allowed)
		}

		return nil
	})
	if err != nil {
		panic(err)
	}

	// Output:
	// bob true
	// alice false
	// carol true
}
