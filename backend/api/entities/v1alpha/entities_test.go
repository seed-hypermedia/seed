package entities

import (
	"testing"

	"github.com/sahilm/fuzzy"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestIsValidIriFilter(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		valid bool
	}{
		{"valid single doc", "hm://abc123/cars/honda", true},
		{"valid subtree glob", "hm://abc123/cars/*", true},
		{"valid account glob", "hm://abc123*", true},
		{"valid all", "hm://*", true},
		{"valid with dashes", "hm://my-account/my-doc", true},
		{"valid with dots", "hm://acc.123/path", true},
		{"valid question mark glob", "hm://abc/?", true},
		{"valid bracket glob", "hm://abc/[abc]", true},
		{"invalid no prefix", "abc://bad", false},
		{"invalid empty", "", false},
		{"invalid sql injection", "hm://; DROP TABLE fts;--", false},
		{"invalid spaces", "hm://acc/path with spaces", false},
		{"invalid quotes", "hm://acc/path'quote", false},
		{"invalid parens", "hm://acc/path()", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isValidIriFilter(tt.input)
			require.Equal(t, tt.valid, got, "isValidIriFilter(%q) must be %v", tt.input, tt.valid)
		})
	}
}

func TestBuildRankMap(t *testing.T) {
	t.Parallel()

	results := []fullDataSearchResult{
		{iri: "hm://a/doc1"},
		{iri: "hm://a/doc2"},
		{iri: "hm://a/doc3"},
		{iri: "hm://a/doc1"}, // Duplicate IRI — must be deduped.
	}

	scores := map[string]int{
		"hm://a/doc1": 10,
		"hm://a/doc2": 50,
		"hm://a/doc3": 30,
	}

	ranks := buildRankMap(results, func(r fullDataSearchResult) int { return scores[r.iri] })

	require.Equal(t, 1, ranks["hm://a/doc2"], "doc2 has highest score (50) so must be rank 1")
	require.Equal(t, 2, ranks["hm://a/doc3"], "doc3 has score 30 so must be rank 2")
	require.Equal(t, 3, ranks["hm://a/doc1"], "doc1 has lowest score (10) so must be rank 3")
	require.Len(t, ranks, 3, "must have 3 unique IRIs")
}

func TestSemanticDedup_SingleResults(t *testing.T) {
	t.Parallel()

	// Groups of 1 must all be kept.
	results := []fullDataSearchResult{
		{iri: "hm://a/doc1", blockID: "b1", contentType: "document", rawContent: "hello", versionTime: timestamppb.Now(), rowID: 1},
		{iri: "hm://a/doc2", blockID: "b1", contentType: "document", rawContent: "world", versionTime: timestamppb.Now(), rowID: 2},
	}
	matches := []fuzzy.Match{
		{Str: "hello", Index: 0},
		{Str: "world", Index: 1},
	}

	// No DB needed — groups of 1 bypass embedding queries.
	filtered, filteredMatches := semanticDedup(t.Context(), nil, results, matches)
	require.Len(t, filtered, 2, "must keep both results when they are in different groups")
	require.Len(t, filteredMatches, 2)
}

func TestSemanticDedup_ExactDuplicateContent(t *testing.T) {
	t.Parallel()

	now := timestamppb.Now()
	earlier := timestamppb.New(now.AsTime().Add(-1))

	// Same iri|blockID|contentType, same rawContent → older must be discarded.
	results := []fullDataSearchResult{
		{iri: "hm://a/doc1", blockID: "b1", contentType: "document", rawContent: "same text", versionTime: now, rowID: 1},
		{iri: "hm://a/doc1", blockID: "b1", contentType: "document", rawContent: "same text", versionTime: earlier, rowID: 2},
	}
	matches := []fuzzy.Match{
		{Str: "same text", Index: 0},
		{Str: "same text", Index: 1},
	}

	// No DB — embeddings missing means rawContent comparison is used as fallback.
	filtered, filteredMatches := semanticDedup(t.Context(), nil, results, matches)
	require.Len(t, filtered, 1, "must collapse exact duplicates to newest")
	require.Equal(t, now, filtered[0].versionTime, "must keep the newest version")
	require.Len(t, filteredMatches, 1)
}

func TestSemanticDedup_DifferentContent_NoEmbeddings(t *testing.T) {
	t.Parallel()

	now := timestamppb.Now()
	earlier := timestamppb.New(now.AsTime().Add(-1))

	// Same iri|blockID|contentType, different rawContent, no embeddings → both kept.
	results := []fullDataSearchResult{
		{iri: "hm://a/doc1", blockID: "b1", contentType: "document", rawContent: "version two text", versionTime: now, rowID: 1},
		{iri: "hm://a/doc1", blockID: "b1", contentType: "document", rawContent: "version one text", versionTime: earlier, rowID: 2},
	}
	matches := []fuzzy.Match{
		{Str: "version two text", Index: 0},
		{Str: "version one text", Index: 1},
	}

	// No DB — embeddings missing so rawContent comparison applies. Different content → keep both.
	filtered, filteredMatches := semanticDedup(t.Context(), nil, results, matches)
	require.Len(t, filtered, 2, "must keep both when content differs and no embeddings")
	require.Len(t, filteredMatches, 2)
}
