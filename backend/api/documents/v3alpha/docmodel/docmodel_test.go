package docmodel

import (
	"seed/backend/core/coretest"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDocmodelSmoke(t *testing.T) {
	alice := coretest.NewTester("alice").Account

	doc := must.Do2(New("mydoc", cclock.New()))
	must.Do(doc.SetMetadata("title", "Hello"))
	c1 := must.Do2(doc.SignChange(alice))

	{
		doc := must.Do2(New("mydoc", cclock.New()))
		must.Do(doc.ApplyChange(c1.CID, c1.Decoded))
		must.Do(doc.SetMetadata("title", "Hello world"))
		c2 := must.Do2(doc.SignChange(alice))

		{
			doc := must.Do2(New("mydoc", cclock.New()))
			must.Do(doc.ApplyChange(c1.CID, c1.Decoded))
			must.Do(doc.ApplyChange(c2.CID, c2.Decoded))

			require.Equal(t, map[string]string{"title": "Hello world"}, doc.crdt.GetMetadata())
		}
	}
}
