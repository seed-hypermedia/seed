package colx

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCommonPrefix(t *testing.T) {
	a := []string{"a", "b", "c", "d"}
	b := []string{"a", "b", "c", "zoo", "hey"}

	want := []string{"a", "b", "c"}
	require.Equal(t, want, a[:CommonPrefix(a, b)])
	require.Equal(t, want, b[:CommonPrefix(a, b)])
	require.Equal(t, want, b[:CommonPrefix(b, a)])
}
