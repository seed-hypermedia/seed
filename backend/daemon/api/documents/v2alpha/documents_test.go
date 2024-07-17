package documents

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseResourceID(t *testing.T) {
	tests := []struct {
		raw        string
		rid        resourceID
		normalized string
		mustFail   bool
	}{
		{raw: "hm://d/docid", rid: resourceID{Type: 'd', UID: "docid"}},
		{raw: "hm://d/docid/", mustFail: true},
		{raw: "hm://a/accid", rid: resourceID{Type: 'a', UID: "accid"}},
		{raw: "hm://d/docid/hello-world", rid: resourceID{Type: 'd', UID: "docid", Path: "hello-world"}},
		{raw: "hm://d/docid/hello-world/nested-path-not-allowed", mustFail: true},
		{raw: "d/docid/hello-world", rid: resourceID{Type: 'd', UID: "docid", Path: "hello-world"}, normalized: "hm://d/docid/hello-world"},
	}

	for _, test := range tests {
		t.Run(test.raw, func(t *testing.T) {
			rid, err := parseResourceID(test.raw)
			if test.mustFail {
				require.Error(t, err)
				return
			} else {
				require.NoError(t, err)
			}

			require.Equal(t, test.rid, rid)

			if test.normalized == "" {
				test.normalized = test.raw
			}
			require.Equal(t, test.normalized, rid.String(), "round trip to string must match")
		})
	}
}
