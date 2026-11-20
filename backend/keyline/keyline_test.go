package keyline_test

import (
	"cmp"
	"context"
	"fmt"
	"slices"
	"testing"

	"seed/backend/keyline"
	"seed/backend/keyline/keylinemem"

	"github.com/stretchr/testify/require"
)

// Keep test expectations independent of Power.Compare.
var powerOrder = []keyline.Power{keyline.None, keyline.Sync, keyline.Read, keyline.Write, keyline.Admin}

func TestPowerMnemonics(t *testing.T) {
	for _, tc := range []struct {
		code  string
		power keyline.Power
	}{
		{"s", keyline.Sync}, {"r", keyline.Read}, {"w", keyline.Write}, {"a", keyline.Admin},
	} {
		t.Run(tc.code, func(t *testing.T) {
			power, err := keyline.ParsePower(tc.code)
			require.NoError(t, err)
			require.Equal(t, tc.power, power)
			require.Equal(t, tc.code[0], byte(power))
			require.Equal(t, tc.code, tc.power.String())
		})
	}

	for _, invalid := range []string{"", "none", "0", "1", "4", "e", "l", "A", "S", "write", " w", "w ", "wr", keyline.Power(255).String()} {
		power, err := keyline.ParsePower(invalid)
		require.Error(t, err, "invalid mnemonic %q", invalid)
		require.Equal(t, keyline.None, power)
	}

	for i, a := range powerOrder {
		for j, b := range powerOrder {
			require.Equal(t, cmp.Compare(i, j), a.Compare(b), "%s compared with %s", a, b)
		}
	}

	for value := range 256 {
		power := keyline.Power(value)
		if slices.Contains(powerOrder[1:], power) {
			continue
		}

		d := keyline.Delegation{ID: "d", Issuer: "s", Audience: "a", Subject: "s", Power: power, BlobID: 1}
		require.Error(t, d.Validate(), "invalid power %d", value)
		allowed, err := keyline.Allows(t.Context(), nil, "s", "s", power)
		require.NoError(t, err)
		require.False(t, allowed, "invalid requirement %d must deny even self-authority", value)

		if power != keyline.None {
			require.Panics(t, func() { power.Compare(keyline.Read) })
			require.Panics(t, func() { keyline.Read.Compare(power) })
		}
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
