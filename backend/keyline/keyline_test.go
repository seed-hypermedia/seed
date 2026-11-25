package keyline_test

import (
	"context"
	"fmt"
	"testing"

	"seed/backend/keyline"
	"seed/backend/keyline/keylinemem"

	"github.com/stretchr/testify/require"
)

// TestPowers checks the stored numbers and names of powers, and that every
// other value is rejected as a power.
func TestPowers(t *testing.T) {
	for _, tc := range []struct {
		power  keyline.Power
		number uint8
		name   string
	}{
		{keyline.None, 0, "none"}, {keyline.Sync, 1, "sync"}, {keyline.Read, 2, "read"}, {keyline.Write, 3, "write"}, {keyline.Admin, 4, "admin"},
	} {
		require.Equal(t, tc.number, uint8(tc.power), "powers are stored by number, which must not change")
		require.Equal(t, tc.name, tc.power.String())
		require.Equal(t, tc.power != keyline.None, tc.power.Valid())
	}

	require.Equal(t, "Power(5)", keyline.Power(5).String())

	for value := range 256 {
		power := keyline.Power(value)
		if power.Valid() {
			continue
		}

		d := keyline.Delegation{ID: "d", Issuer: "s", Audience: "a", Subject: "s", Power: power, BlobID: 1}
		require.Error(t, d.Validate(), "invalid power %d", value)
		allowed, err := keyline.Allows(t.Context(), nil, "s", "s", power)
		require.NoError(t, err)
		require.False(t, allowed, "invalid requirement %d must deny even self-authority", value)
	}
}

func ExampleAllows() {
	store := &keylinemem.Store{}
	ctx := context.Background()

	_, err := store.Apply(ctx, keyline.Batch{Delegations: []keyline.Delegation{
		// A trusted resource-creation fact roots the document in Alice.
		{"creation", "document:notes", "account:alice", "document:notes", keyline.Admin, 1},
		// These facts could come from verified Seed Capability blobs.
		{"cap:bob", "account:alice", "account:bob", "document:notes", keyline.Write, 2},
		{"cap:carol", "account:bob", "account:carol", "document:notes", keyline.Admin, 3},
	}})
	if err != nil {
		panic(err)
	}

	err = store.View(ctx, func(tx keyline.ReadTx) error {
		write, err := keyline.Allows(ctx, tx, "document:notes", "account:carol", keyline.Write)
		if err != nil {
			return err
		}

		admin, err := keyline.Allows(ctx, tx, "document:notes", "account:carol", keyline.Admin)
		if err != nil {
			return err
		}

		fmt.Println(write)
		fmt.Println(admin)
		return nil
	})
	if err != nil {
		panic(err)
	}

	// Output:
	// true
	// false
}
