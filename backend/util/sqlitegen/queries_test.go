package sqlitegen

import (
	"os"
	"seed/backend/testutil"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGoldenFileGenerate(t *testing.T) {
	// This is a manual test that can be executed
	// to regenerate the golden file.
	testutil.Manual(t)
	runTestCodegenQueries(t, true)
}

func TestCodegenQueries(t *testing.T) {
	runTestCodegenQueries(t, false)
}

func runTestCodegenQueries(t *testing.T, writeGoldenFile bool) {
	const goldenFileName = "queries_test.golden"

	code, err := CodegenQueries("testqueries",
		QueryTemplate{
			Name: "getWallet",
			Kind: QueryKindSingle,
			Inputs: []GoSymbol{
				{Name: "walletID", Type: TypeInt},
			},
			Outputs: []GoSymbol{
				{Name: "WalletID", Type: TypeInt},
				{Name: "WalletName", Type: TypeText},
			},
			SQL: "SELECT wallets.id, wallets.name\nFROM wallets\nWHERE wallets.id = ?",
		},
		QueryTemplate{
			Name: "listWallets",
			Kind: QueryKindMany,
			Inputs: []GoSymbol{
				{Name: "cursor", Type: TypeText},
				{Name: "limit", Type: TypeInt},
			},
			Outputs: []GoSymbol{
				{Name: "WalletID", Type: TypeInt},
				{Name: "WalletName", Type: TypeText},
			},
			SQL: "SELECT wallets.id, wallets.name\nFROM wallets\nWHERE wallets.id > ? LIMIT ?",
		},
		QueryTemplate{
			Name: "insertWallet",
			Kind: QueryKindExec,
			Inputs: []GoSymbol{
				{Name: "id", Type: TypeInt},
				{Name: "name", Type: TypeText},
			},
			SQL: "INSERT INTO wallets (id, name) VALUES (?, ?)",
		},
	)
	require.NoError(t, err)

	if writeGoldenFile {
		require.NoError(t, os.WriteFile(goldenFileName, code, 0600))
	}

	goldenData, err := os.ReadFile(goldenFileName)
	require.NoError(t, err)

	require.Equal(t, string(goldenData), string(code))
}
