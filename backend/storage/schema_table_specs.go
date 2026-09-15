package storage

// TableKind identifies how a table participates in a full reindex.
type TableKind byte

const (
	// TableKindPermanent is a table that is not touched by a full reindex.
	TableKindPermanent TableKind = iota
	// TableKindDerived identifies a table that is cleared and rebuilt by a full reindex.
	TableKindDerived
	// TableKindIgnored identifies schema objects that are not part of reindexing.
	// It's basically the same as permanent, but meant for tables that are not defined in our schema,
	// e.g. underlying tables created by virtual table modules in SQLite and things like that.
	TableKindIgnored
)

// TableSpec describes how a schema table participates in a full reindex.
type TableSpec struct {
	Name string
	Kind TableKind
}

// Derived tables are cleaned up during forced reindex.
// Every table in the schema must have an explicitly assigned kind in this list.
// This helps us avoid missing adding a derived table into a list, causing problems during reindex.
// Order of derived tables is important to ensure foreign key constraints are not violated.
var tableSpecs = []TableSpec{
	{Name: T_KV, Kind: TableKindPermanent},
	{Name: T_PublicKeys, Kind: TableKindPermanent},
	{Name: T_Blobs, Kind: TableKindPermanent},
	{Name: T_BlobVisibilityRules, Kind: TableKindPermanent},
	{Name: T_UnreadResources, Kind: TableKindPermanent},
	{Name: T_Subscriptions, Kind: TableKindPermanent},
	{Name: T_Peers, Kind: TableKindPermanent},
	{Name: T_Wallets, Kind: TableKindPermanent},
	{Name: T_Domains, Kind: TableKindPermanent},

	{Name: T_BlobLinks, Kind: TableKindDerived},
	{Name: T_ResourceLinks, Kind: TableKindDerived},
	{Name: T_StructuralBlobs, Kind: TableKindDerived},
	{Name: T_DocumentAttributes, Kind: TableKindDerived},
	{Name: T_DocumentAttributeKeys, Kind: TableKindDerived},
	// These summaries are maintained by the document-fields backfill rather
	// than the full blob reindex, but the final reindex cover pass rebuilds them.
	// Delete child rows first to avoid relying on the FK cascade.
	{Name: T_DocumentReferenceTargets, Kind: TableKindDerived},
	{Name: T_DocumentReferenceSummaries, Kind: TableKindDerived},
	// Comment activity is derived from Comment blobs, so it's rebuilt by the blob
	// loop below. comment_live has an FK to resources with ON DELETE CASCADE, but
	// reindex deletes in list order, so list it before resources rather than
	// relying on the cascade (same reasoning as the RBSR tables at the end of
	// this list).
	{Name: T_CommentLive, Kind: TableKindDerived},
	{Name: T_DocumentCommentStats, Kind: TableKindDerived},
	{Name: T_Resources, Kind: TableKindDerived},
	{Name: T_Spaces, Kind: TableKindDerived},
	{Name: T_DocumentGenerations, Kind: TableKindDerived},
	{Name: T_StashedBlobs, Kind: TableKindDerived},
	{Name: T_Embeddings, Kind: TableKindDerived},
	{Name: T_EmbeddingsIndex, Kind: TableKindDerived},
	{Name: T_Fts, Kind: TableKindDerived},
	{Name: T_FtsIndex, Kind: TableKindDerived},
	{Name: T_BlobVisibility, Kind: TableKindDerived},
	// The maintained RBSR index is derived: drop it on reindex and let it
	// re-materialize lazily on the next reconcile. rbsr_item has an FK to
	// rbsr_scope with ON DELETE CASCADE, but reindex deletes tables in list
	// order, so list rbsr_item before rbsr_scope to avoid relying on cascade.
	{Name: T_RbsrItem, Kind: TableKindDerived},
	{Name: T_RbsrScope, Kind: TableKindDerived},

	// Views and SQLite virtual-table backing tables are not part of reindexing.
	{Name: T_BlobLinksWithTypes, Kind: TableKindIgnored},
	{Name: T_PublicBlobs, Kind: TableKindIgnored},
	{Name: T_EmbeddingsChunks, Kind: TableKindIgnored},
	{Name: T_EmbeddingsInfo, Kind: TableKindIgnored},
	{Name: T_EmbeddingsMetadatachunks00, Kind: TableKindIgnored},
	{Name: T_EmbeddingsRowids, Kind: TableKindIgnored},
	{Name: T_EmbeddingsVectorChunks00, Kind: TableKindIgnored},
	{Name: T_FtsConfig, Kind: TableKindIgnored},
	{Name: T_FtsContent, Kind: TableKindIgnored},
	{Name: T_FtsData, Kind: TableKindIgnored},
	{Name: T_FtsDocsize, Kind: TableKindIgnored},
	{Name: T_FtsIdx, Kind: TableKindIgnored},
	{Name: T_SQLiteSequence, Kind: TableKindIgnored},
}

// TableSpecs returns the schema table classifications used by a full reindex.
func TableSpecs() []TableSpec {
	return tableSpecs
}
