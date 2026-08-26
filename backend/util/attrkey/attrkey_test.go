package attrkey

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSearchKey(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "composed form",
			input: "Caf\u00e9",
			want:  "caf\u00e9",
		},
		{
			name:  "decomposed form",
			input: "Cafe\u0301",
			want:  "caf\u00e9",
		},
		{
			name:  "German sharp s",
			input: "Stra\u00dfe",
			want:  "strasse",
		},
		{
			name:  "Greek final sigma",
			input: "\u039f\u03b4\u03c5\u03c3\u03c3\u03b5\u03cd\u03c2",
			want:  "\u03bf\u03b4\u03c5\u03c3\u03c3\u03b5\u03cd\u03c3",
		},
		{
			name:  "dotted capital I",
			input: "\u0130",
			want:  "i\u0307",
		},
		{
			name:  "dotless I",
			input: "\u0131",
			want:  "\u0131",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.want, SearchKey(test.input))
		})
	}
}

func TestSearchKeyDoesNotUseCompatibilityNormalization(t *testing.T) {
	require.NotEqual(t, SearchKey("\u2460"), SearchKey("1"))
	require.Equal(t, "\u2460", SearchKey("\u2460"))
}

func TestSetUsesExactPaths(t *testing.T) {
	object := map[string]any{}
	Set(object, []string{"Category", "Name"}, "one")
	Set(object, []string{"category", "Age"}, int64(2))

	require.Equal(t, map[string]any{
		"Category": map[string]any{
			"Name": "one",
		},
		"category": map[string]any{
			"Age": int64(2),
		},
	}, object)
}
