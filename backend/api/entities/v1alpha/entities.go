// Package entities implements the Entities API.
package entities

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core"
	entpb "seed/backend/genproto/entities/v1alpha"
	"seed/backend/hlc"
	"seed/backend/hmnet/syncing"
	"seed/backend/llm"
	"seed/backend/util/apiutil"
	"seed/backend/util/dqb"
	"seed/backend/util/errutil"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/ipfs/go-cid"

	"github.com/sahilm/fuzzy"
	"google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"google.golang.org/grpc"
)

// Discoverer is an interface for discovering objects.
type Discoverer interface {
	// TouchHotTask returns or creates a discovery task for the given parameters.
	// The task is ephemeral (evicts when not called) unless a subscription exists for the same IRI.
	TouchHotTask(iri blob.IRI, version blob.Version, recursive bool) syncing.TaskInfo
}

// Server implements Entities API.
type Server struct {
	entpb.UnimplementedEntitiesServer

	db       *sqlitex.Pool
	disc     Discoverer
	embedder llm.LightEmbedder
}

// NewServer creates a new entities server.
func NewServer(db *sqlitex.Pool, disc Discoverer, embedder llm.LightEmbedder) *Server {
	return &Server{
		db:       db,
		disc:     disc,
		embedder: embedder,
	}
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	entpb.RegisterEntitiesServer(rpc, srv)
}

// validIriFilterRe validates iri_filter to prevent GLOB injection.
var validIriFilterRe = regexp.MustCompile(`^hm://[a-zA-Z0-9_\-./\*\?\[\]]*$`)

func isValidIriFilter(s string) bool {
	return validIriFilterRe.MatchString(s)
}

const (
	lastResultTTL = time.Second * 20 // we cache the previous discovery result for this long
	taskTTL       = time.Second * 40 // if the frontend didn't request discovery for this long we discard the task
)

// DiscoverEntity implements the Entities server.
func (srv *Server) DiscoverEntity(_ context.Context, in *entpb.DiscoverEntityRequest) (*entpb.DiscoverEntityResponse, error) {
	if srv.disc == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "discovery is not enabled")
	}

	if in.Account == "" {
		return nil, errutil.MissingArgument("account")
	}

	in.Account = strings.TrimPrefix(in.Account, "hm://")
	in.Path = strings.TrimSuffix(in.Path, "/")

	acc, err := core.DecodePrincipal(in.Account)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "bad account: %v", err)
	}

	iri, err := blob.NewIRI(acc, in.Path)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "bad IRI: %v", err)
	}

	if _, err := blob.Version(in.Version).Parse(); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid version %q: %v", in.Version, err)
	}

	v := blob.Version(in.Version)

	// Delegate to syncing service for task management.
	info := srv.disc.TouchHotTask(iri, v, in.Recursive)

	resp := &entpb.DiscoverEntityResponse{
		Version:  info.Result.String(),
		State:    stateToProto(info.State),
		Progress: progressToProto(info.Progress),
	}

	if info.LastErr != nil {
		resp.LastError = info.LastErr.Error()
	}

	if !info.LastResultTime.IsZero() {
		resp.LastResultTime = timestamppb.New(info.LastResultTime)
		resp.ResultExpireTime = timestamppb.New(info.LastResultTime.Add(lastResultTTL))
	}

	return resp, nil
}

func stateToProto(state syncing.TaskState) entpb.DiscoveryTaskState {
	switch state {
	case syncing.TaskStateIdle:
		return entpb.DiscoveryTaskState_DISCOVERY_TASK_STARTED
	case syncing.TaskStateInProgress:
		return entpb.DiscoveryTaskState_DISCOVERY_TASK_IN_PROGRESS
	case syncing.TaskStateCompleted:
		return entpb.DiscoveryTaskState_DISCOVERY_TASK_COMPLETED
	default:
		return entpb.DiscoveryTaskState_DISCOVERY_TASK_STARTED
	}
}

func progressToProto(prog *syncing.Progress) *entpb.DiscoveryProgress {
	if prog == nil {
		return &entpb.DiscoveryProgress{}
	}
	return &entpb.DiscoveryProgress{
		PeersFound:      prog.PeersFound.Load(),
		PeersSyncedOk:   prog.PeersSyncedOK.Load(),
		PeersFailed:     prog.PeersFailed.Load(),
		BlobsDiscovered: prog.BlobsDiscovered.Load(),
		BlobsDownloaded: prog.BlobsDownloaded.Load(),
		BlobsFailed:     prog.BlobsFailed.Load(),
	}
}

var qGetLatestBlockChange = dqb.Str(`
SELECT
  fts_index.blob_id,
  version,
  block_id,
  ts,
  type,
  b.codec,
  b.multihash
  FROM fts_index
  JOIN blobs b ON b.id = fts_index.blob_id
  WHERE genesis_blob = :genesisBlobID
  AND ts >= :Ts
  AND type IN ('title', 'document', 'meta')
  AND rowid != :rowID
  ORDER BY ts ASC
`)

var QGetMovedBlocks = dqb.Str(`
SELECT
  sb.extra_attrs->>'redirect' AS redirect,
  r.iri,
  dg.is_deleted,
  (
    SELECT json_group_array(
             json_object(
               'codec',    b2.codec,
               'multihash', hex(b2.multihash)
             )
           )
    FROM json_each(dg.heads) AS a
      JOIN blobs AS b2
        ON b2.id = a.value
  ) AS heads
  from structural_blobs sb
  JOIN resources r ON r.id = sb.resource
  JOIN document_generations dg ON dg.resource = (SELECT id FROM resources WHERE iri = sb.extra_attrs->>'redirect')
  WHERE sb.type = 'Ref'
  AND sb.extra_attrs->>'redirect' != ''
  AND sb.genesis_blob IN (SELECT value FROM json_each(:genesisBlobJson));
`)

var qGetFTSByIDs = dqb.Str(`
WITH fts_data AS (
  SELECT
    fts.raw_content,
    fts.type,
    fts.block_id,
    fts.version,
    fts.blob_id,
    structural_blobs.genesis_blob,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
	fts.rowid
  FROM fts
    JOIN structural_blobs
      ON structural_blobs.id = fts.blob_id
    JOIN blobs INDEXED BY blobs_metadata
      ON blobs.id = structural_blobs.id
    JOIN public_keys
      ON public_keys.id = structural_blobs.author
    LEFT JOIN resources
      ON resources.id = structural_blobs.resource
  WHERE fts.rowid IN (SELECT value FROM json_each(?))
	AND blobs.size > 0
)

SELECT
  f.raw_content,
  f.type,
  f.block_id,
  f.version,
  f.blob_id,
  f.tsid,
  resources.iri,
  public_keys.principal AS author,
  pk_subject.principal AS contact_subject,
  blobs.codec,
  blobs.multihash,
  document_generations.metadata,
  dg_subject.metadata AS subject_metadata,
  (
    SELECT json_group_array(
             json_object(
               'codec',    b2.codec,
               'multihash', hex(b2.multihash)
             )
           )
    FROM json_each(document_generations.heads) AS a
      JOIN blobs AS b2
        ON b2.id = a.value
  ) AS heads,
  structural_blobs.ts,
  structural_blobs.genesis_blob,
  f.rowid,
  public_keys.id AS author_id
FROM fts_data AS f
  JOIN structural_blobs
    ON structural_blobs.id = f.blob_id

  JOIN blobs INDEXED BY blobs_metadata
    ON blobs.id = f.blob_id

  JOIN public_keys
    ON public_keys.id = structural_blobs.author

  LEFT JOIN resources
    ON resources.id = (SELECT resource from structural_blobs WHERE
	     (f.blob_id       = structural_blobs.genesis_blob
           AND structural_blobs.type = 'Ref')
      OR (f.genesis_blob = structural_blobs.genesis_blob
           AND structural_blobs.type = 'Ref')
      OR (f.blob_id       = structural_blobs.id
           AND structural_blobs.type = 'Comment')
	  OR (f.blob_id       = structural_blobs.id
           AND structural_blobs.type = 'Contact'
           AND structural_blobs.author = ?)
     limit 1)

  JOIN document_generations
    ON document_generations.resource = resources.id

  LEFT JOIN document_generations dg_subject
	ON dg_subject.resource = (select id from resources where owner in (select extra_attrs->>'subject' from structural_blobs where id = f.blob_id) order by id limit 1)

  LEFT JOIN public_keys pk_subject
    ON pk_subject.id = structural_blobs.extra_attrs->>'subject'

WHERE document_generations.is_deleted = False
`)

var qKeywordSearch = dqb.Str(`
SELECT
    fts.rowid,
    fts.rank
FROM fts
JOIN fts_index fi ON fi.rowid = fts.rowid
JOIN structural_blobs sb ON sb.id = fts.blob_id
JOIN blobs ON blobs.id = fts.blob_id
LEFT JOIN resources r1 ON r1.id = sb.resource
LEFT JOIN blob_links bl ON bl.target = fts.blob_id AND bl.type = 'ref/head'
LEFT JOIN structural_blobs sb_ref ON sb_ref.id = bl.source
LEFT JOIN resources r2 ON r2.id = sb_ref.resource
WHERE fts.raw_content MATCH ?
  AND fts.type IN (?, ?, ?, ?)
  AND blobs.size > 0
  AND COALESCE(r1.iri, r2.iri) IS NOT NULL
  AND COALESCE(r1.iri, r2.iri) GLOB ?
ORDER BY
  (fts.type = 'contact' OR fts.type = 'title') DESC,
  fts.rank ASC
LIMIT ?
`)

// keywordSearch performs minimal FTS search returning SearchResultMap.
// This is a standalone function (not Server method) used for hybrid search.
func keywordSearch(conn *sqlite.Conn, query string, limit int, contentTypes map[string]bool, iriGlob string) (llm.SearchResultMap, error) {
	results := make(llm.SearchResultMap)
	var entityTypeTitle, entityTypeContact, entityTypeDoc, entityTypeComment interface{}
	supportedType := false
	if ok, val := contentTypes["title"]; ok && val {
		entityTypeTitle = "title"
		supportedType = true
	}
	if ok, val := contentTypes["contact"]; ok && val {
		entityTypeContact = "contact"
		supportedType = true
	}
	if ok, val := contentTypes["document"]; ok && val {
		entityTypeDoc = "document"
		supportedType = true
	}
	if ok, val := contentTypes["comment"]; ok && val {
		entityTypeComment = "comment"
		supportedType = true
	}
	if !supportedType {
		return nil, fmt.Errorf("invalid content type filter: at least one of title, contact, document, comment must be specified")
	}
	if len(contentTypes) == 0 {
		return nil, errors.New("at least one content type is required. Otherwise there is nothing to search :)")
	}
	score := float32(999999.9)
	if err := sqlitex.Exec(conn, qKeywordSearch(), func(stmt *sqlite.Stmt) error {
		// The query alredy handles proper ordering and limit. The order depends on type and rank.
		// We assign scores in decreasing order to be consistent with other search methods.
		results[stmt.ColumnInt64(0)] = score
		score--
		return nil
	}, query, entityTypeTitle, entityTypeContact, entityTypeDoc, entityTypeComment, iriGlob, limit); err != nil {
		return nil, fmt.Errorf("keyword search failed: %w", err)
	}

	return results, nil
}

type blendedResult struct {
	result       llm.SearchResult
	semanticRank *int
	keywordRank  *int
}

// blendSearchResults uses RRF (Reciprocal Rank Fusion) to blend semantic and keyword results.
// For single-word queries, keyword results are weighted higher (60%) since semantic embeddings
// are less reliable for short queries. For multi-word queries, equal weights (50/50) are used.
func blendSearchResults(semanticResults, keywordResults llm.SearchResultMap, limit int, query string) llm.SearchResultMap {
	const rrfK = 60

	// Single-word queries: favor keyword (60%) over semantic (40%).
	// Multi-word queries: equal weight (50/50).
	wordCount := len(strings.Fields(query))
	semanticWeight := float32(0.5)
	if wordCount <= 1 {
		semanticWeight = 0.4
	}

	resultMap := make(map[int64]*blendedResult)
	semanticResultsOrdered := semanticResults.ToList(true)
	keywordResultsOrdered := keywordResults.ToList(true)
	// Map semantic results
	for rank, result := range semanticResultsOrdered {
		r := rank + 1
		resultMap[result.RowID] = &blendedResult{
			result:       result,
			semanticRank: &r,
			keywordRank:  nil,
		}
	}

	// Map keyword results
	for rank, result := range keywordResultsOrdered {
		r := rank + 1
		if existing, ok := resultMap[result.RowID]; ok {
			existing.keywordRank = &r
		} else {
			resultMap[result.RowID] = &blendedResult{
				result:       result,
				semanticRank: nil,
				keywordRank:  &r,
			}
		}
	}

	resultList := make([]llm.SearchResult, 0, len(resultMap))
	// Calculate RRF combined scores
	for _, br := range resultMap {
		semanticRRF := float32(0.0)
		keywordRRF := float32(0.0)

		if br.semanticRank != nil {
			semanticRRF = 1.0 / float32(rrfK+*br.semanticRank)
		}
		if br.keywordRank != nil {
			keywordRRF = 1.0 / float32(rrfK+*br.keywordRank)
		}

		combinedScore := semanticWeight*semanticRRF + (1-semanticWeight)*keywordRRF
		resultList = append(resultList, llm.SearchResult{Score: combinedScore, RowID: br.result.RowID})
	}

	// Sort by combined score with RowID as tie-breaker for deterministic ordering.
	slices.SortFunc(resultList, func(a, b llm.SearchResult) int {
		if a.Score < b.Score {
			return 1
		} else if a.Score > b.Score {
			return -1
		}
		// Tie-breaker: sort by RowID for deterministic ordering.
		if a.RowID < b.RowID {
			return -1
		} else if a.RowID > b.RowID {
			return 1
		}
		return 0
	})

	// Take top winners
	winners := resultList[:min(limit, len(resultList))]
	return llm.SearchResultList(winners).ToMap()
}

// Document citation count: how many times each resource is linked to by others.
var qDocAuthority = dqb.Str(`
SELECT r.iri, COUNT(*) AS mention_count
FROM resource_links rl
JOIN resources r ON r.id = rl.target
WHERE r.iri IN (SELECT value FROM json_each(?))
GROUP BY rl.target
`)

// Author external citation count with self-citation filtering.
// Uses CTE to deduplicate authors, then counts external citations per author.
var qAuthorAuthority = dqb.Str(`
WITH doc_authors AS (
	SELECT DISTINCT doc.owner AS author_id
	FROM json_each(?) je
	JOIN resources doc ON doc.iri = je.value
	WHERE doc.owner IS NOT NULL
),
author_scores AS (
	SELECT da.author_id,
		   COUNT(*) AS external_citations
	FROM doc_authors da
	JOIN resources r ON r.owner = da.author_id
	JOIN resource_links rl ON rl.target = r.id
	JOIN structural_blobs sb ON sb.id = rl.source
	WHERE sb.author IS NULL OR sb.author <> da.author_id
	GROUP BY da.author_id
)
SELECT doc.iri AS doc_iri,
	   COALESCE(s.external_citations, 0) AS author_external_citations
FROM json_each(?) je
JOIN resources doc ON doc.iri = je.value
LEFT JOIN author_scores s ON s.author_id = doc.owner
`)

// buildRankMap creates a map from IRI to 1-based rank, sorted by score desc.
func buildRankMap(results []fullDataSearchResult, scoreFn func(fullDataSearchResult) int) map[string]int {
	type entry struct {
		iri   string
		score int
	}
	seen := make(map[string]bool)
	var entries []entry
	for _, r := range results {
		if !seen[r.iri] {
			seen[r.iri] = true
			entries = append(entries, entry{r.iri, scoreFn(r)})
		}
	}
	slices.SortFunc(entries, func(a, b entry) int {
		if a.score > b.score {
			return -1
		}
		if a.score < b.score {
			return 1
		}
		return 0
	})
	ranks := make(map[string]int, len(entries))
	for i, e := range entries {
		ranks[e.iri] = i + 1
	}
	return ranks
}

// applyAuthorityRanking re-scores results using citation-based authority signals.
// The weight parameter controls the balance between text relevance and authority.
func applyAuthorityRanking(ctx context.Context, db *sqlitex.Pool,
	results []fullDataSearchResult, bodyMatches []fuzzy.Match,
	weight float32,
) ([]fullDataSearchResult, []fuzzy.Match, error) {
	if len(results) == 0 {
		return results, bodyMatches, nil
	}

	// Collect unique IRIs.
	iris := make([]string, 0, len(results))
	seen := make(map[string]bool)
	for _, r := range results {
		if !seen[r.iri] {
			seen[r.iri] = true
			iris = append(iris, r.iri)
		}
	}
	irisJSON, err := json.Marshal(iris)
	if err != nil {
		return nil, nil, err
	}

	// Run both authority queries in a single DB connection.
	docCitations := make(map[string]int)
	authorCitations := make(map[string]int)

	if err := db.WithSave(ctx, func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn, qDocAuthority(), func(stmt *sqlite.Stmt) error {
			docCitations[stmt.ColumnText(0)] = stmt.ColumnInt(1)
			return nil
		}, string(irisJSON)); err != nil {
			return err
		}
		return sqlitex.Exec(conn, qAuthorAuthority(), func(stmt *sqlite.Stmt) error {
			authorCitations[stmt.ColumnText(0)] = stmt.ColumnInt(1)
			return nil
		}, string(irisJSON), string(irisJSON))
	}); err != nil {
		return nil, nil, err
	}

	// Build rank maps from citation counts.
	docAuthRanks := buildRankMap(results, func(r fullDataSearchResult) int { return docCitations[r.iri] })
	authorAuthRanks := buildRankMap(results, func(r fullDataSearchResult) int { return authorCitations[r.iri] })

	// Re-score each result.
	const rrfK = 60
	textWeight := 1.0 - weight
	docAuthWeight := 0.7 * weight
	authorAuthWeight := 0.3 * weight

	for i := range results {
		textRank := i + 1 // Current position is the text rank (results are already sorted by score).
		textRRF := 1.0 / float32(rrfK+textRank)

		var docRRF float32
		if r, ok := docAuthRanks[results[i].iri]; ok {
			docRRF = 1.0 / float32(rrfK+r)
		}

		var authRRF float32
		if r, ok := authorAuthRanks[results[i].iri]; ok {
			authRRF = 1.0 / float32(rrfK+r)
		}

		results[i].score = textWeight*textRRF + docAuthWeight*docRRF + authorAuthWeight*authRRF
	}

	// Re-sort results and bodyMatches together by new score.
	// Use rowID as tie-breaker for deterministic ordering when scores are equal.
	indices := make([]int, len(results))
	for i := range indices {
		indices[i] = i
	}
	slices.SortFunc(indices, func(a, b int) int {
		if results[a].score > results[b].score {
			return -1
		}
		if results[a].score < results[b].score {
			return 1
		}
		// Tie-breaker: sort by rowID for deterministic ordering.
		if results[a].rowID < results[b].rowID {
			return -1
		}
		if results[a].rowID > results[b].rowID {
			return 1
		}
		return 0
	})

	sorted := make([]fullDataSearchResult, len(results))
	sortedMatches := make([]fuzzy.Match, len(bodyMatches))
	for newIdx, oldIdx := range indices {
		sorted[newIdx] = results[oldIdx]
		bm := bodyMatches[oldIdx]
		bm.Index = newIdx
		sortedMatches[newIdx] = bm
	}

	return sorted, sortedMatches, nil
}

var qIsDeletedComment = dqb.Str(`
    SELECT
        CASE WHEN extra_attrs->>'deleted' = '1' THEN 1 ELSE 0 END AS is_deleted
    FROM structural_blobs
    WHERE type = 'Comment'
      AND author = :author_id
      AND extra_attrs->>'tsid' = :tsid
    ORDER BY ts DESC
    LIMIT 1;
`)

var qGetMetadata = dqb.Str(`
	select dg.metadata, r.iri, pk.principal from document_generations dg
	INNER JOIN resources r ON r.id = dg.resource
	INNER JOIN public_keys pk ON pk.id = r.owner
	WHERE dg.is_deleted = False;`)

var qGetParentsMetadata = dqb.Str(`
	select dg.metadata, r.iri from document_generations dg
	INNER JOIN resources r ON r.id = dg.resource
	WHERE dg.is_deleted = False AND r.iri GLOB :iriGlob;`)

var qGetAccountID = dqb.Str(`
	SELECT id FROM public_keys WHERE principal = unhex(:principal) LIMIT 1;
`)

type commentIdentifier struct {
	authorID int64
	tsid     string
}

type fullDataSearchResult struct {
	content       string
	rawContent    string
	icon          string
	iri           string
	owner         string
	metadata      string
	blockID       string
	tsid          string
	docID         string
	blobCID       string
	blobID        int64
	genesisBlobID int64
	rowID         int64
	contentType   string
	version       string
	versionTime   *timestamppb.Timestamp
	latestVersion string
	latestBlobCID string // CID of the latest blob (first head), used for version upgrade.
	commentKey    commentIdentifier
	isDeleted     bool
	score         float32
	parentTitles  []string
	id            string
}

// MovedResource represents a resource that has been relocated.
type MovedResource struct {
	// NewIri is the IRI of the new location of the resource.
	NewIri string

	// OldIri is the IRI of the old location of the resource.
	OldIri string

	// IsDeleted indicates whether the resource has been deleted.
	IsDeleted bool

	// LatestVersion is the latest version of the moved resource.
	LatestVersion string
}

// SearchEntities implements the Fuzzy search of entpb.
func (srv *Server) SearchEntities(ctx context.Context, in *entpb.SearchEntitiesRequest) (*entpb.SearchEntitiesResponse, error) {
	type value struct {
		Value string `json:"v"`
	}
	type title struct {
		Name value `json:"name"`
	}
	type icon struct {
		Icon value `json:"icon"`
	}

	type head struct {
		Multihash string `json:"multihash"`
		Codec     uint64 `json:"codec"`
	}
	re := regexp.MustCompile(`[^A-Za-z0-9_ ]+`)
	cleanQuery := re.ReplaceAllString(in.Query, "")
	// collapse multiple spaces to a single space
	cleanQuery = strings.Join(strings.Fields(cleanQuery), " ")
	if strings.ReplaceAll(cleanQuery, " ", "") == "" {
		return nil, nil
	}
	var bodyMatches []fuzzy.Match
	contentTypes := map[string]bool{}
	if len(in.ContentTypeFilter) > 0 {
		for _, ct := range in.ContentTypeFilter {
			switch ct {
			case entpb.ContentTypeFilter_CONTENT_TYPE_TITLE:
				contentTypes["title"] = true
			case entpb.ContentTypeFilter_CONTENT_TYPE_DOCUMENT:
				contentTypes["document"] = true
			case entpb.ContentTypeFilter_CONTENT_TYPE_COMMENT:
				contentTypes["comment"] = true
			case entpb.ContentTypeFilter_CONTENT_TYPE_CONTACT:
				contentTypes["contact"] = true
			}
		}
	} else {
		// Legacy fallback.
		contentTypes["title"] = true
		contentTypes["contact"] = true
		if in.IncludeBody {
			contentTypes["document"] = true
			contentTypes["comment"] = true

		}
	}
	var loggedAccountID int64 = 0
	if in.LoggedAccountUid != "" {
		ppal, err := core.DecodePrincipal(in.LoggedAccountUid)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "bad provided logged account UID %s: %v", in.LoggedAccountUid, err)
		}
		ppalHex := hex.EncodeToString(ppal)
		if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			return sqlitex.Exec(conn, qGetAccountID(), func(stmt *sqlite.Stmt) error {
				loggedAccountID = stmt.ColumnInt64(0)
				return nil
			}, strings.ToUpper(ppalHex))
		}); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "Problem getting logged account ID %s: %v", in.LoggedAccountUid, err)
		}
		// TODO: Remove auto-include of contacts once frontend uses content_type_filter explicitly.
		contentTypes["contact"] = true
	}
	// Adjust results limit based on search type
	resultsLmit := 300
	if in.SearchType == entpb.SearchType_SEARCH_HYBRID || in.SearchType == entpb.SearchType_SEARCH_SEMANTIC {
		resultsLmit = 200
	} else if len(cleanQuery) < 3 {
		resultsLmit = 100
	}
	ftsStrKeySearch := strings.ReplaceAll(cleanQuery, " ", "+")
	if ftsStrKeySearch[len(ftsStrKeySearch)-1] == '+' {
		ftsStrKeySearch = ftsStrKeySearch[:len(ftsStrKeySearch)-1]
	}
	ftsStrKeySearch += "*"
	if in.ContextSize < 2 {
		in.ContextSize = 48
	}

	var iriGlob string
	if in.IriFilter != "" {
		if !isValidIriFilter(in.IriFilter) {
			return nil, status.Errorf(codes.InvalidArgument, "iri_filter contains invalid characters")
		}
		iriGlob = in.IriFilter
	} else if in.AccountUid != "" {
		iriGlob = "hm://" + in.AccountUid + "*"
	} else {
		iriGlob = "hm://*"
	}
	contextBefore := int(math.Ceil(float64(in.ContextSize) / 2.0))
	contextAfter := int(in.ContextSize) - contextBefore
	var numResults int = 0

	// Prepare variables for semantic/hybrid search
	query := cleanQuery

	winners := llm.SearchResultMap{}
	const semanticThreshold = 0.45 // 0.55 Minimum similarity for relevant results with granite-embedding-107m-multilingual model.

	// Check if semantic search is requested but embedder is not available.
	if srv.embedder == nil && (in.SearchType == entpb.SearchType_SEARCH_HYBRID || in.SearchType == entpb.SearchType_SEARCH_SEMANTIC) {
		return nil, status.Errorf(codes.Unavailable, "semantic search is not available: embedding service is disabled")
	}

	switch in.SearchType {
	case entpb.SearchType_SEARCH_HYBRID:
		// Hybrid search: run semantic + keyword concurrently, blend with RRF
		var semanticResults, keywordResults llm.SearchResultMap
		var semanticErr, keywordErr error
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			semanticResults, semanticErr = srv.embedder.SemanticSearch(ctx, query, resultsLmit*3, contentTypes, iriGlob, semanticThreshold)
		}()
		go func() {
			defer wg.Done()
			keywordErr = srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
				var err error
				keywordResults, err = keywordSearch(conn, ftsStrKeySearch, resultsLmit*3, contentTypes, iriGlob)
				return err
			})
		}()
		wg.Wait()
		if keywordErr != nil {
			return nil, fmt.Errorf("keyword search failed: %w", keywordErr)
		}

		// Handle semantic search errors.
		if semanticErr != nil {
			if errors.Is(semanticErr, llm.ErrUnreliableEmbedding) {
				// Query embedding is unreliable (rare/unknown word). Fall back to keyword-only results.
				winners = keywordResults
			} else {
				return nil, fmt.Errorf("semantic search failed: %w", semanticErr)
			}
		} else {
			// Blend results with RRF.
			winners = blendSearchResults(semanticResults, keywordResults, resultsLmit*2, query)
		}

	case entpb.SearchType_SEARCH_SEMANTIC:
		// Semantic-only search.
		var err error
		winners, err = srv.embedder.SemanticSearch(ctx, query, resultsLmit*2, contentTypes, iriGlob, semanticThreshold)
		if err != nil {
			if errors.Is(err, llm.ErrUnreliableEmbedding) {
				// Query embedding is unreliable. Return empty results for semantic-only search.
				winners = llm.SearchResultMap{}
			} else {
				return nil, fmt.Errorf("semantic search failed: %w", err)
			}
		}

	default:
		// Keyword only search:
		err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			var err error
			winners, err = keywordSearch(conn, ftsStrKeySearch, resultsLmit, contentTypes, iriGlob)
			return err
		})
		if err != nil {
			return nil, fmt.Errorf("keyword search failed: %w", err)
		}
	}
	winnerIDsJSON, err := json.Marshal(winners.Keys())
	if err != nil {
		return nil, fmt.Errorf("failed to marshal winner IDs: %w", err)
	}
	searchResults := []fullDataSearchResult{}
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qGetFTSByIDs(), func(stmt *sqlite.Stmt) error {
			var res fullDataSearchResult
			var icon icon
			var heads []head
			res.rawContent = stmt.ColumnText(0)

			// Semantic results may not contain the query pattern (fuzzy match).
			// So we find the first occurrence of the query pattern for context extraction.
			firstRuneOffset, _, matchedRunes, _ := indexOfQueryPattern(res.rawContent, cleanQuery)
			fullRunes := []rune(res.rawContent)
			nRunes := len(fullRunes)
			var contextStart, contextEndRune int
			contextEndRune = nRunes
			if firstRuneOffset > contextBefore {
				contextStart = firstRuneOffset - contextBefore
			}
			if firstRuneOffset+matchedRunes < nRunes-contextAfter {
				contextEndRune = firstRuneOffset + matchedRunes + contextAfter
			}
			res.content = string(fullRunes[contextStart:contextEndRune])

			res.blobCID = cid.NewCidV1(uint64(stmt.ColumnInt64(9)), stmt.ColumnBytesUnsafe(10)).String()
			res.contentType = stmt.ColumnText(1)
			res.blockID = stmt.ColumnText(2)
			res.version = stmt.ColumnText(3)
			res.blobID = stmt.ColumnInt64(4)
			res.tsid = stmt.ColumnText(5)
			res.docID = stmt.ColumnText(6)
			res.owner = core.Principal(stmt.ColumnBytes(7)).String()
			subjectID := core.Principal(stmt.ColumnBytes(8)).String()
			res.metadata = stmt.ColumnText(11)
			if err := json.Unmarshal(stmt.ColumnBytes(11), &icon); err != nil {
				icon.Icon.Value = ""
			}
			if err := json.Unmarshal(stmt.ColumnBytes(13), &heads); err != nil {
				return err
			}

			cids := make([]cid.Cid, len(heads))
			for i, h := range heads {
				mhBinary, err := hex.DecodeString(h.Multihash)
				if err != nil {
					return err
				}
				cids[i] = cid.NewCidV1(h.Codec, mhBinary)
			}
			res.latestVersion = docmodel.NewVersion(cids...).String()
			if len(cids) > 0 {
				res.latestBlobCID = cids[0].String()
			}

			ts := hlc.Timestamp(stmt.ColumnInt64(14) * 1000).Time()
			res.versionTime = timestamppb.New(ts)
			res.genesisBlobID = stmt.ColumnInt64(15)
			if res.genesisBlobID == 0 {
				res.genesisBlobID = res.blobID
			}
			res.rowID = stmt.ColumnInt64(16)
			res.score = winners[res.rowID]
			switch res.contentType {
			case "comment":
				res.iri = "hm://" + res.owner + "/" + res.tsid
				res.commentKey = commentIdentifier{
					authorID: stmt.ColumnInt64(17),
					tsid:     res.tsid,
				}
			case "contact":
				res.iri = "hm://" + subjectID + "/" + res.tsid
				if err := json.Unmarshal(stmt.ColumnBytes(12), &icon); err != nil {
					icon.Icon.Value = ""
				}
			default:
				res.iri = res.docID
			}
			res.icon = icon.Icon.Value

			// For semantic, no fuzzy matching offsets
			bodyMatches = append(bodyMatches, fuzzy.Match{
				Str:            res.content,
				Index:          numResults,
				Score:          1,
				MatchedIndexes: []int{},
			})
			searchResults = append(searchResults, res)
			numResults++
			return nil
		}, string(winnerIDsJSON), loggedAccountID)
	}); err != nil {
		return nil, err
	}
	seen := make(map[string]int)
	var uniqueResults []fullDataSearchResult
	var uniqueBodyMatches []fuzzy.Match
	for i, res := range searchResults {
		key := fmt.Sprintf("%s|%s|%s|%s", res.iri, res.blockID, res.rawContent, res.contentType)
		if idx, ok := seen[key]; ok {
			// duplicate – compare blobID
			if res.versionTime.AsTime().After(uniqueResults[idx].versionTime.AsTime()) {
				uniqueResults[idx] = res
				bm := bodyMatches[i]
				bm.Index = idx
				uniqueBodyMatches[idx] = bm
			}
		} else {
			// first time seeing this key
			seen[key] = len(uniqueResults)
			uniqueResults = append(uniqueResults, res)
			bm := bodyMatches[i]
			bm.Index = len(uniqueResults) - 1
			uniqueBodyMatches = append(uniqueBodyMatches, bm)
		}
	}
	bodyMatches = uniqueBodyMatches
	searchResults = uniqueResults

	// Authority-based re-ranking.
	if in.AuthorityWeight > 0 {
		if in.AuthorityWeight > 1 {
			return nil, status.Errorf(codes.InvalidArgument, "authority_weight must be between 0 and 1")
		}

		// Sort results by score before authority ranking.
		// applyAuthorityRanking uses position as textRank, so results must be sorted by
		// text relevance first. Use rowID as tie-breaker for deterministic ordering.
		indices := make([]int, len(searchResults))
		for i := range indices {
			indices[i] = i
		}
		slices.SortFunc(indices, func(a, b int) int {
			if searchResults[a].score > searchResults[b].score {
				return -1
			}
			if searchResults[a].score < searchResults[b].score {
				return 1
			}
			if searchResults[a].rowID < searchResults[b].rowID {
				return -1
			}
			if searchResults[a].rowID > searchResults[b].rowID {
				return 1
			}
			return 0
		})

		// Reorder searchResults and bodyMatches according to sorted indices.
		sortedResults := make([]fullDataSearchResult, len(searchResults))
		sortedMatches := make([]fuzzy.Match, len(bodyMatches))
		for newIdx, oldIdx := range indices {
			sortedResults[newIdx] = searchResults[oldIdx]
			bm := bodyMatches[oldIdx]
			bm.Index = newIdx
			sortedMatches[newIdx] = bm
		}
		searchResults = sortedResults
		bodyMatches = sortedMatches

		var err error
		searchResults, bodyMatches, err = applyAuthorityRanking(ctx, srv.db, searchResults, bodyMatches, in.AuthorityWeight)
		if err != nil {
			return nil, fmt.Errorf("authority ranking failed: %w", err)
		}
	}

	matchingEntities := []*entpb.Entity{}
	// Pre-fetch all parent metadata in a single query instead of per-result.
	parentTitleMap := make(map[string]string) // iri -> title
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qGetParentsMetadata(), func(stmt *sqlite.Stmt) error {
			var t title
			if err := json.Unmarshal(stmt.ColumnBytes(0), &t); err != nil {
				return nil
			}
			parentTitleMap[stmt.ColumnText(1)] = t.Name.Value
			return nil
		}, iriGlob)
	}); err != nil {
		return nil, err
	}

	getParentsFcn := func(match fuzzy.Match) []string {
		breadcrumb := strings.Split(strings.TrimPrefix(searchResults[match.Index].iri, "hm://"), "/")
		var parentTitles []string
		for i := range breadcrumb {
			parentIRI := "hm://" + strings.Join(breadcrumb[:i+1], "/")
			if t, ok := parentTitleMap[parentIRI]; ok && t != match.Str {
				parentTitles = append(parentTitles, t)
			}
		}
		return parentTitles
	}
	totalLatestBlockTime := time.Duration(0)
	timesCalled, timesCalled2 := 0, 0
	iter := 0
	//prevIter := 0
	genesisBlobIDs := make([]string, 0, len(searchResults))
	for _, match := range bodyMatches {
		genesisBlobIDs = append(genesisBlobIDs, strconv.FormatInt(searchResults[match.Index].genesisBlobID, 10))
	}

	var movedResources []MovedResource
	genesisBlobJson := "[" + strings.Join(genesisBlobIDs, ",") + "]"
	err = srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, QGetMovedBlocks(), func(stmt *sqlite.Stmt) error {
			var heads []head
			if err := json.Unmarshal(stmt.ColumnBytes(3), &heads); err != nil {
				return err
			}

			cids := make([]cid.Cid, len(heads))
			for i, h := range heads {
				mhBinary, err := hex.DecodeString(h.Multihash)
				if err != nil {
					return err
				}
				cids[i] = cid.NewCidV1(h.Codec, mhBinary)
			}
			movedResources = append(movedResources, MovedResource{
				NewIri:        stmt.ColumnText(0),
				OldIri:        stmt.ColumnText(1),
				IsDeleted:     stmt.ColumnInt(2) == 1,
				LatestVersion: docmodel.NewVersion(cids...).String(),
			})
			return nil
		}, genesisBlobJson)
	})
	if err != nil {
		return nil, err
	}
	for _, movedResource := range movedResources {
		for i, result := range searchResults {
			if result.iri == movedResource.OldIri {
				if movedResource.IsDeleted {
					searchResults[i].isDeleted = true
				} else {
					searchResults[i].iri = movedResource.NewIri
				}
				searchResults[i].latestVersion = movedResource.LatestVersion
			}
		}
	}
	startParents := time.Now()
	totalGetParentsTime := time.Duration(0)
	totalDeletedTime := time.Duration(0)
	totalCommentsTime := time.Duration(0)
	totalNonCommentsTime := time.Duration(0)
	finalResults := []fullDataSearchResult{}
	for _, match := range bodyMatches {
		totalGetParentsTime += time.Since(startParents)
		startParents = time.Now()
		if searchResults[match.Index].isDeleted {
			// Skip deleted resources
			totalDeletedTime += time.Since(startParents)
			continue
		}
		if searchResults[match.Index].contentType != "contact" {
			searchResults[match.Index].parentTitles = getParentsFcn(match)
		}

		offsets := make([]int64, len(match.MatchedIndexes))
		for j, off := range match.MatchedIndexes {
			offsets[j] = int64(off)
		}
		id := searchResults[match.Index].iri

		// Version Upgrade Heuristic:
		//
		// Search results are indexed at specific versions (when content was added/modified).
		// To provide useful deep links, we upgrade versions to show the "best" version:
		//
		// 1. If the indexed version IS already in the document's latest version, keep it
		//    and mark with "&l" (latest) suffix.
		//
		// 2. If the indexed version is NOT the latest:
		//    a. Query for all changes after the indexed version (qGetLatestBlockChange).
		//    b. Iterate through changes in chronological order:
		//       - If the SAME BLOCK (same type + blockID) was modified, stop iteration.
		//         This means the content has changed, so keep the original version.
		//       - Otherwise, track this change as the latest "unrelated" change.
		//    c. If no same-block change was found (relatedFound=false):
		//       - Upgrade to the latest unrelated change's version (content still exists).
		//       - If that's still not the document's latest, upgrade to latest version.
		//    d. If same-block change WAS found (relatedFound=true):
		//       - Keep the original indexed version (content may have changed).
		//
		// Special cases:
		// - Titles have empty blockID, so any title change triggers "same block" detection.
		// - Multi-block commits: Multiple blocks modified in same commit share a version.
		//   We must check for same-block BEFORE updating latestUnrelated to avoid
		//   incorrectly using a sibling block's version from the same commit.
		//
		// Fields updated: version, blobID, blobCID, versionTime.
		// The "&l" suffix is added later if the final version is in latestVersion.
		if searchResults[match.Index].version != "" && searchResults[match.Index].contentType != "comment" {
			startLatestBlockTime := time.Now()

			// Change tracks version info during the upgrade heuristic iteration.
			type Change struct {
				blobID  int64
				blobCID string
				version string
				ts      *timestamppb.Timestamp
			}
			latestUnrelated := Change{
				blobID:  searchResults[match.Index].blobID,
				blobCID: searchResults[match.Index].blobCID,
				version: searchResults[match.Index].version,
				ts:      searchResults[match.Index].versionTime,
			}

			var errSameBlockChangeDetected = errors.New("same block change detected")
			if !slices.Contains(strings.Split(searchResults[match.Index].latestVersion, "."), latestUnrelated.version) {
				timesCalled++
				//prevIter = iter
				relatedFound := false
				err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
					return sqlitex.Exec(conn, qGetLatestBlockChange(), func(stmt *sqlite.Stmt) error {
						iter++
						ts := hlc.Timestamp(stmt.ColumnInt64(3) * 1000).Time()
						blockID := stmt.ColumnText(2)
						changeType := stmt.ColumnText(4)
						currentChange := Change{
							blobID:  stmt.ColumnInt64(0),
							blobCID: cid.NewCidV1(uint64(stmt.ColumnInt64(5)), stmt.ColumnBytesUnsafe(6)).String(),
							version: stmt.ColumnText(1),
							ts:      timestamppb.New(ts),
						}
						if searchResults[match.Index].contentType == changeType && blockID == searchResults[match.Index].blockID {
							return errSameBlockChangeDetected
						}
						latestUnrelated = currentChange
						return nil
					}, searchResults[match.Index].genesisBlobID, searchResults[match.Index].versionTime.Seconds*1_000+int64(searchResults[match.Index].versionTime.Nanos)/1_000_000, searchResults[match.Index].rowID)
				})
				if err != nil && !errors.Is(err, errSameBlockChangeDetected) {
					return nil, err
				} else if err != nil && errors.Is(err, errSameBlockChangeDetected) {
					relatedFound = true
				}
				// If the latest unrelated change is still not the document's latest version,
				// upgrade to the document's latest version and use the latest blob CID.
				if !relatedFound && !slices.Contains(strings.Split(searchResults[match.Index].latestVersion, "."), latestUnrelated.version) {
					latestUnrelated.version = searchResults[match.Index].latestVersion
					latestUnrelated.blobCID = searchResults[match.Index].latestBlobCID
				}

				// Only update version if no same-block change was detected.
				// When relatedFound is true, the block was modified after the indexed version,
				// so we keep the original version (where the content existed).
				if !relatedFound {
					searchResults[match.Index].version = latestUnrelated.version
					searchResults[match.Index].blobID = latestUnrelated.blobID
					searchResults[match.Index].blobCID = latestUnrelated.blobCID
					searchResults[match.Index].versionTime = latestUnrelated.ts
				}
			}
			totalLatestBlockTime += time.Since(startLatestBlockTime)
			if slices.Contains(strings.Split(searchResults[match.Index].latestVersion, "."), searchResults[match.Index].version) {
				searchResults[match.Index].version += "&l"
			}
			if searchResults[match.Index].version != "" {
				id += "?v=" + searchResults[match.Index].version
			}

			if searchResults[match.Index].blockID != "" {
				id += "#" + searchResults[match.Index].blockID
				if len(offsets) > 1 {
					id += "[" + strconv.FormatInt(offsets[0], 10) + ":" + strconv.FormatInt(offsets[len(offsets)-1]+1, 10) + "]"
				}
			}
			totalNonCommentsTime += time.Since(startParents)
		} else if searchResults[match.Index].contentType == "comment" {
			var isDeleted bool
			timesCalled2++
			err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
				return sqlitex.Exec(conn, qIsDeletedComment(), func(stmt *sqlite.Stmt) error {
					isDeleted = stmt.ColumnInt(0) == 1
					return nil
				}, searchResults[match.Index].commentKey.authorID, searchResults[match.Index].commentKey.tsid)
			})
			if err != nil {
				return nil, err
			}
			totalCommentsTime += time.Since(startParents)
			if isDeleted {
				// If the comment is deleted, we don't return it
				continue
			}
		}
		searchResults[match.Index].id = id
		searchResults[match.Index].content = match.Str
		finalResults = append(finalResults, searchResults[match.Index])
	}
	//after = time.Now()
	//fmt.Printf("getParentsFcn took %.3f s\n", totalGetParentsTime.Seconds())
	//fmt.Printf("totalDeletedTime took %.3f s\n", totalDeletedTime.Seconds())
	//fmt.Printf("totalNonCommentsTime took %.3f s\n", totalNonCommentsTime.Seconds())
	//fmt.Printf("totalCommentsTime took %.3f s and called %d times\n", totalCommentsTime.Seconds(), timesCalled2)

	//fmt.Printf("qGetLatestBlockChange took %.3f s and was called %d times and iterated over %d records\n", totalLatestBlockTime.Seconds(), timesCalled, iter)
	slices.SortFunc(finalResults, orderBySimilarity)
	for _, match := range finalResults {
		matchingEntities = append(matchingEntities, &entpb.Entity{
			DocId:       match.docID,
			Id:          match.id,
			BlobId:      match.blobCID,
			Type:        match.contentType,
			VersionTime: match.versionTime,
			Content:     match.content,
			ParentNames: match.parentTitles,
			Icon:        match.icon,
			Owner:       match.owner,
			Metadata:    match.metadata,
		})
	}

	// Paginate if page_size is set. When 0, return everything (backwards compatible).
	var nextPageToken string
	if in.PageSize > 0 {
		var cursor struct {
			Offset int `json:"o"`
		}
		if in.PageToken != "" {
			if err := apiutil.DecodePageToken(in.PageToken, &cursor, nil); err != nil {
				return nil, status.Errorf(codes.InvalidArgument, "invalid page_token: %v", err)
			}
		}
		if cursor.Offset >= len(matchingEntities) {
			matchingEntities = nil
		} else {
			end := cursor.Offset + int(in.PageSize)
			if end < len(matchingEntities) {
				nextCursor := struct {
					Offset int `json:"o"`
				}{Offset: end}
				nextPageToken = apiutil.EncodePageToken(nextCursor, nil)
				matchingEntities = matchingEntities[cursor.Offset:end]
			} else {
				matchingEntities = matchingEntities[cursor.Offset:]
			}
		}
	}

	return &entpb.SearchEntitiesResponse{
		Entities:      matchingEntities,
		NextPageToken: nextPageToken,
	}, nil
}

func orderByTitle(a, b fullDataSearchResult) int {
	// 1) contacts first
	isContactA := a.contentType == "contact"
	isContactB := b.contentType == "contact"
	if isContactA != isContactB {
		if isContactA {
			return -1
		}
		return 1
	}

	// 2) then titles
	isTitleA := a.contentType == "title"
	isTitleB := b.contentType == "title"
	if isTitleA != isTitleB {
		if isTitleA {
			return -1
		}
		return 1
	}

	// 3) everything else (including within contacts and titles) by Score descending (higher first)
	if a.score != b.score {
		if a.score > b.score {
			return -1 // a comes first (higher score)
		}
		return 1 // b comes first (higher score)
	}
	return 0
}

// orderBySimilarity sorts entities by similarity score descending (higher scores first).
func orderBySimilarity(a, b fullDataSearchResult) int {
	// Higher scores first (descending order)
	if a.score > b.score {
		return -1
	} else if a.score < b.score {
		return 1
	}
	// If scores are equal, fall back to title ordering
	return orderByTitle(a, b)
}

// DeleteEntity implements the corresponding gRPC method.
// func (api *Server) DeleteEntity(ctx context.Context, in *entpb.DeleteEntityRequest) (*emptypb.Empty, error) {
// 	var meta string
// 	var qGetResourceMetadata = dqb.Str(`
//   	SELECT meta from meta_view
// 	WHERE iri = :eid
// 	`)

// 	if in.Id == "" {
// 		return nil, status.Errorf(codes.InvalidArgument, "must specify entity ID to delete")
// 	}

// 	eid := hyper.EntityID(in.Id)

// 	err := api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		return sqlitex.Exec(conn, qGetResourceMetadata(), func(stmt *sqlite.Stmt) error {
// 			meta = stmt.ColumnText(0)
// 			return nil
// 		}, in.Id)
// 	})
// 	if err != nil {
// 		return nil, err
// 	}
// 	err = api.blobs.ForEachComment(ctx, eid.String(), func(c cid.Cid, cmt hyper.Comment, conn *sqlite.Conn) error {
// 		referencedDocument := strings.Split(cmt.Target, "?v=")[0]
// 		if referencedDocument == eid.String() {
// 			_, err = hypersql.BlobsDelete(conn, c.Hash())
// 			if err != nil {
// 				if err = hypersql.BlobsEmptyByHash(conn, c.Hash()); err != nil {
// 					return err
// 				}
// 			}
// 			if cmt.RepliedComment.String() != "" {
// 				_, err = hypersql.BlobsDelete(conn, cmt.RepliedComment.Hash())
// 				if err != nil {
// 					if err = hypersql.BlobsEmptyByHash(conn, cmt.RepliedComment.Hash()); err != nil {
// 						return err
// 					}
// 				}
// 			}

// 			return nil
// 		}
// 		return nil
// 	})

// 	err = api.blobs.DeleteEntity(ctx, eid)
// 	if err != nil {
// 		if errors.Is(err, hyper.ErrEntityNotFound) {
// 			return nil, err
// 		}

// 		_, err = &emptypb.Empty{}, api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 			return hypersql.BlobsEmptyByEID(conn, in.Id)
// 		})
// 		if err != nil {
// 			return &emptypb.Empty{}, err
// 		}

// 		_, err = &emptypb.Empty{}, api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 			return hypersql.BlobsStructuralDelete(conn, in.Id)
// 		})
// 		if err != nil {
// 			return &emptypb.Empty{}, err
// 		}
// 	}
// 	_, err = &emptypb.Empty{}, api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		return sqlitex.WithTx(conn, func() error {
// 			res, err := hypersql.EntitiesInsertRemovedRecord(conn, eid.String(), in.Reason, meta)
// 			if err != nil {
// 				return err
// 			}
// 			if res.ResourceEID != eid.String() {
// 				return fmt.Errorf("%w: %s", hyper.ErrEntityNotFound, eid)
// 			}

// 			return nil
// 		})
// 	})
// 	return &emptypb.Empty{}, err
// }

// // UndeleteEntity implements the corresponding gRPC method.
// func (api *Server) UndeleteEntity(ctx context.Context, in *entpb.UndeleteEntityRequest) (*emptypb.Empty, error) {
// 	if in.Id == "" {
// 		return nil, status.Errorf(codes.InvalidArgument, "must specify entity ID to restore")
// 	}

// 	eid := hyper.EntityID(in.Id)

// 	return &emptypb.Empty{}, api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		return hypersql.EntitiesDeleteRemovedRecord(conn, eid.String())
// 	})
// }

// // ListDeletedEntities implements the corresponding gRPC method.
// func (api *Server) ListDeletedEntities(ctx context.Context, _ *entpb.ListDeletedEntitiesRequest) (*entpb.ListDeletedEntitiesResponse, error) {
// 	resp := &entpb.ListDeletedEntitiesResponse{
// 		DeletedEntities: make([]*entpb.DeletedEntity, 0),
// 	}

// 	err := api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		list, err := hypersql.EntitiesListRemovedRecords(conn)
// 		if err != nil {
// 			return err
// 		}
// 		for _, entity := range list {
// 			resp.DeletedEntities = append(resp.DeletedEntities, &entpb.DeletedEntity{
// 				Id:            entity.DeletedResourcesIRI,
// 				DeleteTime:    &timestamppb.Timestamp{Seconds: entity.DeletedResourcesDeleteTime},
// 				DeletedReason: entity.DeletedResourcesReason,
// 				Metadata:      entity.DeletedResourcesMeta,
// 			})
// 		}
// 		return nil
// 	})

// 	return resp, err
// }

// ListEntityMentions implements listing mentions of an entity in other resources.
func (srv *Server) ListEntityMentions(ctx context.Context, in *entpb.ListEntityMentionsRequest) (*entpb.ListEntityMentionsResponse, error) {
	if in.Id == "" {
		return nil, errutil.MissingArgument("id")
	}

	var cursor mentionsCursor
	if in.PageToken != "" {
		if err := cursor.FromString(in.PageToken); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to decode page token: %v", err)
		}
	}

	// Without this querying in reverse order wouldn't ever return any results.
	if in.ReverseOrder && in.PageToken == "" {
		cursor.BlobID = math.MaxInt64
		cursor.LinkID = math.MaxInt64
	}

	// Arbitrary default page size.
	if in.PageSize == 0 {
		in.PageSize = 10
	}

	resp := &entpb.ListEntityMentionsResponse{}
	var genesisBlobIDs []string
	var deletedList []string
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		var eid int64
		if err := sqlitex.Exec(conn, qEntitiesLookupID(), func(stmt *sqlite.Stmt) error {
			eid = stmt.ColumnInt64(0)
			return nil
		}, in.Id); err != nil {
			return err
		}

		if eid == 0 {
			return status.Errorf(codes.NotFound, "entity '%s' is not found", in.Id)
		}

		var lastCursor mentionsCursor

		var count int32
		if err := sqlitex.Exec(conn, qListMentions(in.ReverseOrder), func(stmt *sqlite.Stmt) error {
			// We query for pageSize + 1 items to know if there's more items on the next page,
			// because if not we don't need to return the page token in the response.
			if count == in.PageSize {
				resp.NextPageToken = lastCursor.String()
				return nil
			}

			count++

			var (
				sourceDoc     string
				source        = stmt.ColumnText(0)
				sourceBlob    = cid.NewCidV1(uint64(stmt.ColumnInt64(1)), stmt.ColumnBytesUnsafe(2)).String()
				author        = core.Principal(stmt.ColumnBytesUnsafe(3)).String()
				ts            = hlc.Timestamp(stmt.ColumnInt64(4) * 1000).Time()
				blobType      = stmt.ColumnText(5)
				isPinned      = stmt.ColumnInt(6) > 0
				anchor        = stmt.ColumnText(7)
				targetVersion = stmt.ColumnText(8)
				fragment      = stmt.ColumnText(9)
				tsid          = blob.TSID(stmt.ColumnText(12))
				mentionType   = stmt.ColumnText(13)
				isDeleted     = stmt.ColumnText(15) == "1"
			)
			genesisBlobIDs = append(genesisBlobIDs, strconv.FormatInt(stmt.ColumnInt64(14), 10))
			lastCursor.BlobID = stmt.ColumnInt64(10)
			lastCursor.LinkID = stmt.ColumnInt64(11)

			if source == "" && blobType != "Comment" {
				return fmt.Errorf("BUG: missing source for mention of type '%s'", blobType)
			}

			if blobType == "Comment" {
				ts = tsid.Timestamp()
				sourceDoc = source
				source = "hm://" + author + "/" + tsid.String()

			}
			if isDeleted {
				deletedList = append(deletedList, source)
			}

			resp.Mentions = append(resp.Mentions, &entpb.Mention{
				Source:        source,
				SourceType:    blobType,
				SourceContext: anchor,
				SourceBlob: &entpb.Mention_BlobInfo{
					Cid:        sourceBlob,
					Author:     author,
					CreateTime: timestamppb.New(ts),
				},
				SourceDocument: sourceDoc,
				Target:         in.Id,
				TargetVersion:  targetVersion,
				IsExactVersion: isPinned,
				TargetFragment: fragment,
				MentionType:    mentionType,
			})

			return nil
		}, eid, cursor.BlobID, in.PageSize); err != nil {
			return err
		}

		return nil
	}); err != nil {
		return nil, err
	}
	genesisBlobJson := "[" + strings.Join(genesisBlobIDs, ",") + "]"
	var movedResources []MovedResource
	err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, QGetMovedBlocks(), func(stmt *sqlite.Stmt) error {
			movedResources = append(movedResources, MovedResource{
				NewIri:    stmt.ColumnText(0),
				OldIri:    stmt.ColumnText(1),
				IsDeleted: stmt.ColumnInt(2) == 1,
			})
			return nil
		}, genesisBlobJson)
	})
	if err != nil {
		return nil, err
	}
	for _, movedResource := range movedResources {
		for i, result := range resp.Mentions {
			if result.Source == movedResource.OldIri {
				resp.Mentions[i].Source = movedResource.NewIri
			}
		}
	}

	seenMentions := make(map[string]bool)
	uniqueMentions := make([]*entpb.Mention, 0, len(resp.Mentions))
	for _, m := range resp.Mentions {
		key := fmt.Sprintf("%s|%s|%s|%s|%t", m.Source, m.SourceType, m.TargetVersion, m.TargetFragment, m.IsExactVersion)
		if !seenMentions[key] && !slices.Contains(deletedList, m.Source) {
			seenMentions[key] = true
			uniqueMentions = append(uniqueMentions, m)
		}
	}
	resp.Mentions = uniqueMentions

	return resp, nil
}

var qEntitiesLookupID = dqb.Str(`
	SELECT resources.id
	FROM resources
	WHERE resources.iri = :entities_eid
	LIMIT 1
`)

const qListMentionsTpl = `
WITH changes AS (
SELECT
    structural_blobs.genesis_blob,
	structural_blobs.ts,
    resource_links.id AS link_id,
    resource_links.is_pinned,
    blobs.codec,
    blobs.multihash,
	blobs.id,
	public_keys.principal AS author,
    resource_links.extra_attrs->>'a' AS anchor,
	resource_links.extra_attrs->>'v' AS target_version,
	resource_links.extra_attrs->>'f' AS target_fragment,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
	resource_links.type,
	structural_blobs.genesis_blob
FROM resource_links
JOIN structural_blobs ON structural_blobs.id = resource_links.source
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
WHERE resource_links.target = :target
AND structural_blobs.type IN ('Change')
)
SELECT
    resources.iri,
    blobs.codec,
    blobs.multihash,
	public_keys.principal AS author,
    structural_blobs.ts,
    structural_blobs.type AS blob_type,
    resource_links.is_pinned,
    resource_links.extra_attrs->>'a' AS anchor,
	resource_links.extra_attrs->>'v' AS target_version,
	resource_links.extra_attrs->>'f' AS target_fragment,
    blobs.id AS blob_id,
    resource_links.id AS link_id,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
	resource_links.type AS link_type,
	structural_blobs.genesis_blob,
	structural_blobs.extra_attrs->>'deleted' AS is_deleted
FROM resource_links
JOIN structural_blobs ON structural_blobs.id = resource_links.source
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
WHERE resource_links.target = :target
AND blobs.id %s :blob_id
AND structural_blobs.type IN ('Comment')
GROUP BY resources.iri, link_id, target_version, target_fragment

UNION ALL
SELECT
    resources.iri,
    blobs.codec,
    blobs.multihash,
    public_keys.principal AS author,
    changes.ts,
    'Ref' AS blob_type,
    changes.is_pinned,
    changes.anchor,
	changes.target_version,
	changes.target_fragment,
    blobs.id AS blob_id,
    changes.link_id,
	structural_blobs.extra_attrs->>'tsid' AS tsid,
	changes.type AS link_type,
	changes.genesis_blob,
	structural_blobs.extra_attrs->>'deleted' AS is_deleted
FROM structural_blobs
JOIN blobs INDEXED BY blobs_metadata ON blobs.id = structural_blobs.id
JOIN public_keys ON public_keys.id = structural_blobs.author
LEFT JOIN resources ON resources.id = structural_blobs.resource
JOIN changes ON (((changes.genesis_blob = structural_blobs.genesis_blob OR changes.id = structural_blobs.genesis_blob) AND structural_blobs.type = 'Ref') OR (changes.id = structural_blobs.id AND structural_blobs.type = 'Comment'))
AND blobs.id %s :blob_id
GROUP BY resources.iri, changes.link_id, target_version, target_fragment
ORDER BY blobs.id %s
LIMIT :page_size + 1;
`

func qListMentions(desc bool) string {
	if desc {
		return qListMentionsDesc()
	}

	return qListMentionsAsc()
}

var qListMentionsAsc = dqb.Q(func() string {
	return fmt.Sprintf(qListMentionsTpl, ">", ">", "ASC")
})

var qListMentionsDesc = dqb.Q(func() string {
	return fmt.Sprintf(qListMentionsTpl, "<", "<", "DESC")
})

type mentionsCursor struct {
	BlobID int64 `json:"b"`
	LinkID int64 `json:"l"`
}

func (mc *mentionsCursor) FromString(s string) error {
	data, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, mc)
}

func (mc mentionsCursor) String() string {
	if mc.BlobID == 0 && mc.LinkID == 0 {
		return ""
	}

	data, err := json.Marshal(mc)
	if err != nil {
		panic(err)
	}

	return base64.RawURLEncoding.EncodeToString(data)
}

func patternToRegex(pattern string) string {
	// If the user specifies ^ or $ at the beginning or end, we keep them.
	startAnchor := strings.HasPrefix(pattern, "^")
	endAnchor := strings.HasSuffix(pattern, "$")
	// Remove anchors temporarily.
	p := pattern
	if startAnchor {
		p = strings.TrimPrefix(p, "^")
	}
	if endAnchor {
		p = strings.TrimSuffix(p, "$")
	}
	// Escape meta characters.
	quoted := regexp.QuoteMeta(p)
	// Replace escaped wildcard with a pattern matching non-whitespace characters.
	quoted = strings.ReplaceAll(quoted, "\\*", "[^\\s]*")
	if startAnchor {
		quoted = "^" + quoted
	}
	if endAnchor {
		quoted = quoted + "$"
	}
	// Make search case-insensitive.
	return "(?i)" + quoted
}

func indexOfQueryPattern(haystack, pattern string) (startRunes, startChars, matchedRunes, matchedChars int) {
	// Convert the pattern to a regex pattern.
	regexPattern := patternToRegex(pattern)
	re := regexp.MustCompile(regexPattern)
	loc := re.FindStringIndex(haystack)
	if loc == nil {
		return 0, 0, 0, 0
	}
	// The start index in runes.
	startRunes = utf8.RuneCountInString(haystack[:loc[0]])
	// The start index in characters (bytes).
	startChars = loc[0]
	// The matched length in runes.
	matchedRunes = utf8.RuneCountInString(haystack[loc[0]:loc[1]])
	// The matched length in characters (bytes).
	matchedChars = loc[1] - loc[0]
	return
}
