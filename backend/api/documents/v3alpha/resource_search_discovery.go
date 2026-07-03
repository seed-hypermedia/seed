package documents

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
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

	"go.uber.org/zap"
)

// Discoverer is an interface for discovering objects.
type Discoverer interface {
	// TouchHotTask returns or creates a discovery task for the given parameters.
	// The task is ephemeral (evicts when not called) unless a subscription exists for the same IRI.
	// blobTypes is an optional structural-blob-type allowlist (e.g. ["Profile","Ref","Change"]);
	// nil/empty disables the filter so all blob types are discovered (default behavior).
	// depthOne, when true, limits recursion to direct children of iri (mutually exclusive with recursive).
	TouchHotTask(iri blob.IRI, version blob.Version, recursive bool, depthOne bool, blobTypes []string) syncing.TaskInfo
}

// validIriFilterRe validates iri_filter to prevent GLOB injection.
var validIriFilterRe = regexp.MustCompile(`^hm://[a-zA-Z0-9_\-./\*\?\[\]]*$`)

func isValidIriFilter(s string) bool {
	return validIriFilterRe.MatchString(s)
}

func (srv *Server) publicOnlyForIRIGlob(ctx context.Context, iriGlob string) (bool, error) {
	if !srv.cfg.PublicOnly {
		return false, nil
	}

	iriRaw := strings.TrimSuffix(iriGlob, "*")
	return srv.publicOnlyForResource(ctx, strings.TrimSuffix(iriRaw, "/"))
}

func (srv *Server) publicOnlyForResource(ctx context.Context, resourceID string) (bool, error) {
	if !srv.cfg.PublicOnly {
		return false, nil
	}

	caller, ok := blob.GetAuthenticatedCaller(ctx)
	if !ok {
		return true, nil
	}

	account, _, ok := resourceAccountPath(resourceID)
	if !ok {
		return true, nil
	}

	allowed := false
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		ok, err := blob.CanWriteRootInDB(conn, account, caller)
		if err != nil {
			return err
		}
		allowed = ok
		return nil
	}); err != nil {
		return true, err
	}

	return !allowed, nil
}

func resourceAccountPath(resourceID string) (core.Principal, string, bool) {
	const prefix = "hm://"
	if !strings.HasPrefix(resourceID, prefix) {
		return nil, "", false
	}
	rest := strings.TrimPrefix(resourceID, prefix)
	accountRaw, path, _ := strings.Cut(rest, "/")
	account, err := core.DecodePrincipal(accountRaw)
	if err != nil {
		return nil, "", false
	}
	if path != "" {
		path = "/" + strings.Trim(path, "/")
	}
	return account, path, true
}

const (
	lastResultTTL = time.Second * 20 // we cache the previous discovery result for this long
	taskTTL       = time.Second * 40 // if the frontend didn't request discovery for this long we discard the task
)

// DiscoverResource implements the Resources server.
func (srv *Server) DiscoverResource(_ context.Context, in *documents.DiscoverResourceRequest) (*documents.DiscoverResourceResponse, error) {
	if srv.disc == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "discovery is not enabled")
	}

	var (
		iri       blob.IRI
		recursive bool
		depthOne  bool
		blobTypes []string
	)

	if in.Id != "" {
		if in.Account != "" || in.Path != "" || in.Recursive {
			return nil, status.Error(codes.InvalidArgument, "id is mutually exclusive with account, path, and recursive")
		}
		t, err := parseDiscoveryURL(in.Id)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "bad id: %v", err)
		}
		iri = t.IRI
		recursive = t.Recursive
		depthOne = t.DepthOne
		blobTypes = t.BlobTypes
	} else {
		if in.Account == "" {
			return nil, errutil.MissingArgument("account")
		}

		in.Account = strings.TrimPrefix(in.Account, "hm://")
		in.Path = strings.TrimSuffix(in.Path, "/")

		acc, err := core.DecodePrincipal(in.Account)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "bad account: %v", err)
		}

		iri, err = blob.NewIRI(acc, in.Path)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "bad IRI: %v", err)
		}

		recursive = in.Recursive
	}

	if _, err := blob.Version(in.Version).Parse(); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid version %q: %v", in.Version, err)
	}

	v := blob.Version(in.Version)

	// Delegate to syncing service for task management.
	info := srv.disc.TouchHotTask(iri, v, recursive, depthOne, blobTypes)

	resp := &documents.DiscoverResourceResponse{
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

func stateToProto(state syncing.TaskState) documents.DiscoveryTaskState {
	switch state {
	case syncing.TaskStateIdle:
		return documents.DiscoveryTaskState_DISCOVERY_TASK_STARTED
	case syncing.TaskStateInProgress:
		return documents.DiscoveryTaskState_DISCOVERY_TASK_IN_PROGRESS
	case syncing.TaskStateCompleted:
		return documents.DiscoveryTaskState_DISCOVERY_TASK_COMPLETED
	default:
		return documents.DiscoveryTaskState_DISCOVERY_TASK_STARTED
	}
}

func progressToProto(prog *syncing.Progress) *documents.DiscoveryProgress {
	if prog == nil {
		return &documents.DiscoveryProgress{}
	}
	return &documents.DiscoveryProgress{
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
WITH RECURSIVE
fts_data AS (
  SELECT
    fts.raw_content,
    fts.type,
    fts.block_id,
    fts.version,
    fts.blob_id,
    structural_blobs.genesis_blob,
    structural_blobs.resource,
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
),
latest_document_generations AS (
  SELECT dg.*
  FROM document_generations dg
  GROUP BY dg.resource
  HAVING dg.generation = MAX(dg.generation)
),
-- Only seed the recursive redirect walk with comments whose resource actually
-- has a known redirect. Other comments rely on the COALESCE(ecr.resource,
-- f.resource) fallback in the outer LEFT JOIN below, so they still resolve
-- correctly without paying the recursion+ROW_NUMBER cost.
comment_resource_chain(origin_resource, resource, iri, depth) AS (
  SELECT DISTINCT
    f.resource,
    f.resource,
    resources.iri,
    0
  FROM fts_data f
  JOIN resources ON resources.id = f.resource
  WHERE f.type = 'comment'
  AND f.resource IS NOT NULL
  AND f.resource IN (
    SELECT resource FROM latest_document_generations
    WHERE metadata->>'$."$db.redirect".v' IS NOT NULL
  )

  UNION ALL

  SELECT
    cr.origin_resource,
    target.id,
    target.iri,
    cr.depth + 1
  FROM comment_resource_chain cr
  JOIN latest_document_generations dg ON dg.resource = cr.resource
  JOIN resources target ON target.iri = dg.metadata->>'$."$db.redirect".v'
  WHERE dg.metadata->>'$."$db.redirect".v' IS NOT NULL
  AND target.id != cr.resource
  AND cr.depth < 16
),
effective_comment_resources AS (
  SELECT origin_resource, resource, iri
  FROM (
    SELECT
      cr.*,
      ROW_NUMBER() OVER (PARTITION BY cr.origin_resource ORDER BY cr.depth DESC) rn
    FROM comment_resource_chain cr
  )
  WHERE rn = 1
),
current_document_resources AS (
  SELECT rowid, resource, metadata, heads, is_deleted
  FROM (
    SELECT
      f.rowid,
      resources.id AS resource,
      dg.metadata,
      dg.heads,
      dg.is_deleted,
      ROW_NUMBER() OVER (
        PARTITION BY f.rowid
        ORDER BY dg.last_alive_ref_time DESC, resources.id DESC
      ) AS rn
    FROM fts_data f
    CROSS JOIN resources INDEXED BY resources_by_genesis_blob
    JOIN document_generations dg
      ON dg.resource = resources.id
    WHERE f.type IN ('title', 'document')
    AND resources.genesis_blob = COALESCE(f.genesis_blob, f.blob_id)
    AND dg.generation = (
      SELECT MAX(dg2.generation)
      FROM document_generations dg2
      WHERE dg2.resource = resources.id
    )
    AND dg.is_deleted = False
    AND dg.metadata->>'$."$db.redirect".v' IS NULL
  )
  WHERE rn = 1
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
  COALESCE(current_document_resources.metadata, current_document_generation.metadata, document_generations.metadata, structural_blobs.extra_attrs, '{}'),
  dg_subject.metadata AS subject_metadata,
  COALESCE((
    SELECT json_group_array(
             json_object(
               'codec',    b2.codec,
               'multihash', hex(b2.multihash)
             )
           )
    FROM json_each(COALESCE(current_document_resources.heads, current_document_generation.heads, document_generations.heads, '[]')) AS a
      JOIN blobs AS b2
        ON b2.id = a.value
  ), '[]') AS heads,
  structural_blobs.ts,
  structural_blobs.genesis_blob,
  f.rowid,
  public_keys.id AS author_id,
  structural_blobs.extra_attrs
FROM fts_data AS f
  JOIN structural_blobs
    ON structural_blobs.id = f.blob_id

  JOIN blobs INDEXED BY blobs_metadata
    ON blobs.id = f.blob_id

  JOIN public_keys
    ON public_keys.id = structural_blobs.author

  LEFT JOIN effective_comment_resources ecr
    ON ecr.origin_resource = f.resource

  LEFT JOIN current_document_resources
    ON current_document_resources.rowid = f.rowid

  LEFT JOIN resources
    ON resources.id = COALESCE(
      -- For comments: prefer the redirected target from the CTE; fall back to
      -- the comment's own resource for the 99%+ of comments whose resource
      -- has no redirect entry (the CTE no longer seeds those).
      CASE WHEN f.type = 'comment' THEN COALESCE(ecr.resource, f.resource) END,
      CASE WHEN f.type IN ('title', 'document') THEN current_document_resources.resource END,
      CASE WHEN f.type NOT IN ('comment', 'title', 'document') THEN
      (SELECT resource from structural_blobs WHERE
	     (f.blob_id       = structural_blobs.genesis_blob
           AND structural_blobs.type = 'Ref')
      OR (f.genesis_blob = structural_blobs.genesis_blob
           AND structural_blobs.type = 'Ref')
      OR (f.blob_id       = structural_blobs.id
           AND structural_blobs.type = 'Comment')
	  OR (f.blob_id       = structural_blobs.id
           AND structural_blobs.type = 'Contact'
           AND structural_blobs.author = ?)
      OR (f.blob_id       = structural_blobs.id
           AND structural_blobs.type = 'Profile')
     limit 1)
      END)

  LEFT JOIN document_generations
    ON document_generations.resource = resources.id
    AND f.type NOT IN ('comment', 'title', 'document')

  LEFT JOIN latest_document_generations AS current_document_generation
    ON current_document_generation.resource = resources.id
    AND f.type = 'comment'

  LEFT JOIN document_generations dg_subject
	ON dg_subject.resource = (select id from resources where owner in (select extra_attrs->>'subject' from structural_blobs where id = f.blob_id) order by id limit 1)

  LEFT JOIN public_keys pk_subject
    ON pk_subject.id = structural_blobs.extra_attrs->>'subject'

WHERE (f.type = 'profile' OR COALESCE(current_document_resources.is_deleted, current_document_generation.is_deleted, document_generations.is_deleted) = False)
`)

// qKeywordSearch returns FTS5 hits for the given query, filtered to the supplied
// content types, optional visibility, and optional IRI glob. The CTE applies the
// cheap per-blob filters (`blobs.size > 0`, visibility) and a sort+LIMIT *before*
// the expensive cross-table joins, so the post-join work is bounded by the
// oversample budget regardless of how many FTS rows the MATCH produced. The outer
// ORDER BY uses the same sort key as the inner one, so the inner top-N is the
// outer top-N modulo the few outer-only filters (IRI resolution + GLOB).
//
// Args: query, type1, type2, type3, type4, type5, publicOnly, oversample, iriGlob, limit.
var qKeywordSearch = dqb.Str(`
WITH RECURSIVE
matched_fts AS MATERIALIZED (
  SELECT
    fts.rowid,
    fts.rank,
    fts.blob_id,
    fts.type
  FROM fts
  JOIN blobs ON blobs.id = fts.blob_id AND blobs.size > 0
  WHERE fts.raw_content MATCH ?
    AND fts.type IN (?, ?, ?, ?, ?)
    AND (? = 0
         OR EXISTS (SELECT 1 FROM blob_visibility v WHERE v.id = fts.blob_id AND v.space = 0))
  ORDER BY
    (fts.type = 'contact' OR fts.type = 'title' OR fts.type = 'profile') DESC,
    fts.rank ASC
  LIMIT ?
),
latest_document_generations AS (
  SELECT dg.*
  FROM document_generations dg
  GROUP BY dg.resource
  HAVING dg.generation = MAX(dg.generation)
),
-- Only seed the recursive redirect walk with comments whose resource actually
-- has a known redirect entry. The other 99%+ of comments fall through to
-- r1.iri via the COALESCE in the outer SELECT, skipping the CTE entirely.
comment_resource_chain(origin_resource, resource, iri, depth) AS (
  SELECT DISTINCT
    sb.resource,
    sb.resource,
    resources.iri,
    0
  FROM matched_fts mf
  JOIN structural_blobs sb ON sb.id = mf.blob_id
  JOIN resources ON resources.id = sb.resource
  WHERE mf.type = 'comment'
  AND sb.resource IS NOT NULL
  AND sb.resource IN (
    SELECT resource FROM latest_document_generations
    WHERE metadata->>'$."$db.redirect".v' IS NOT NULL
  )

  UNION ALL

  SELECT
    cr.origin_resource,
    target.id,
    target.iri,
    cr.depth + 1
  FROM comment_resource_chain cr
  JOIN latest_document_generations dg ON dg.resource = cr.resource
  JOIN resources target ON target.iri = dg.metadata->>'$."$db.redirect".v'
  WHERE dg.metadata->>'$."$db.redirect".v' IS NOT NULL
  AND target.id != cr.resource
  AND cr.depth < 16
),
effective_comment_resources AS (
  SELECT origin_resource, resource, iri
  FROM (
    SELECT
      cr.*,
      ROW_NUMBER() OVER (PARTITION BY cr.origin_resource ORDER BY cr.depth DESC) rn
    FROM comment_resource_chain cr
  )
  WHERE rn = 1
)
SELECT
    mf.rowid,
    mf.rank
FROM matched_fts mf
JOIN fts_index fi ON fi.rowid = mf.rowid
JOIN structural_blobs sb ON sb.id = mf.blob_id
LEFT JOIN resources r1 ON r1.id = sb.resource
-- The blob_links/sb_ref/r2 fallback only matters when sb.resource is null and
-- the blob is pointed to by a ref/head edge — a path that never applies to
-- comments (comments always have a resource). Gating the join on
-- mf.type != 'comment' skips the per-row index probe entirely for the common
-- comment-heavy path.
LEFT JOIN blob_links bl ON bl.target = mf.blob_id AND bl.type = 'ref/head' AND mf.type != 'comment'
LEFT JOIN structural_blobs sb_ref ON sb_ref.id = bl.source
LEFT JOIN resources r2 ON r2.id = sb_ref.resource
LEFT JOIN effective_comment_resources ecr ON ecr.origin_resource = sb.resource
WHERE COALESCE(CASE WHEN mf.type = 'comment' THEN ecr.iri END, r1.iri, r2.iri) IS NOT NULL
  AND COALESCE(CASE WHEN mf.type = 'comment' THEN ecr.iri END, r1.iri, r2.iri) GLOB ?
ORDER BY
  (mf.type = 'contact' OR mf.type = 'title' OR mf.type = 'profile') DESC,
  mf.rank ASC
LIMIT ?
`)

// qKeywordSearchAllIRIs is the same as qKeywordSearch but without the per-row
// IRI GLOB predicate. Used when the caller passes the catch-all default
// (`hm://*` or empty), since every resource in our schema has an `hm://` IRI
// and the GLOB would just be paid for nothing.
//
// Args: query, type1, type2, type3, type4, type5, publicOnly, oversample, limit.
var qKeywordSearchAllIRIs = dqb.Str(`
WITH RECURSIVE
matched_fts AS MATERIALIZED (
  SELECT
    fts.rowid,
    fts.rank,
    fts.blob_id,
    fts.type
  FROM fts
  JOIN blobs ON blobs.id = fts.blob_id AND blobs.size > 0
  WHERE fts.raw_content MATCH ?
    AND fts.type IN (?, ?, ?, ?, ?)
    AND (? = 0
         OR EXISTS (SELECT 1 FROM blob_visibility v WHERE v.id = fts.blob_id AND v.space = 0))
  ORDER BY
    (fts.type = 'contact' OR fts.type = 'title' OR fts.type = 'profile') DESC,
    fts.rank ASC
  LIMIT ?
),
latest_document_generations AS (
  SELECT dg.*
  FROM document_generations dg
  GROUP BY dg.resource
  HAVING dg.generation = MAX(dg.generation)
),
-- Only seed the recursive redirect walk with comments whose resource actually
-- has a known redirect entry; see qKeywordSearch above for rationale.
comment_resource_chain(origin_resource, resource, iri, depth) AS (
  SELECT DISTINCT
    sb.resource,
    sb.resource,
    resources.iri,
    0
  FROM matched_fts mf
  JOIN structural_blobs sb ON sb.id = mf.blob_id
  JOIN resources ON resources.id = sb.resource
  WHERE mf.type = 'comment'
  AND sb.resource IS NOT NULL
  AND sb.resource IN (
    SELECT resource FROM latest_document_generations
    WHERE metadata->>'$."$db.redirect".v' IS NOT NULL
  )

  UNION ALL

  SELECT
    cr.origin_resource,
    target.id,
    target.iri,
    cr.depth + 1
  FROM comment_resource_chain cr
  JOIN latest_document_generations dg ON dg.resource = cr.resource
  JOIN resources target ON target.iri = dg.metadata->>'$."$db.redirect".v'
  WHERE dg.metadata->>'$."$db.redirect".v' IS NOT NULL
  AND target.id != cr.resource
  AND cr.depth < 16
),
effective_comment_resources AS (
  SELECT origin_resource, resource, iri
  FROM (
    SELECT
      cr.*,
      ROW_NUMBER() OVER (PARTITION BY cr.origin_resource ORDER BY cr.depth DESC) rn
    FROM comment_resource_chain cr
  )
  WHERE rn = 1
)
SELECT
    mf.rowid,
    mf.rank
FROM matched_fts mf
JOIN fts_index fi ON fi.rowid = mf.rowid
JOIN structural_blobs sb ON sb.id = mf.blob_id
LEFT JOIN resources r1 ON r1.id = sb.resource
-- See qKeywordSearch above: the ref/head fallback never applies to comments.
LEFT JOIN blob_links bl ON bl.target = mf.blob_id AND bl.type = 'ref/head' AND mf.type != 'comment'
LEFT JOIN structural_blobs sb_ref ON sb_ref.id = bl.source
LEFT JOIN resources r2 ON r2.id = sb_ref.resource
LEFT JOIN effective_comment_resources ecr ON ecr.origin_resource = sb.resource
WHERE COALESCE(CASE WHEN mf.type = 'comment' THEN ecr.iri END, r1.iri, r2.iri) IS NOT NULL
ORDER BY
  (mf.type = 'contact' OR mf.type = 'title' OR mf.type = 'profile') DESC,
  mf.rank ASC
LIMIT ?
`)

// keywordSearchOversampleFactor is how much more we ask the inner FTS+visibility
// CTE for than the caller's final limit. Rows can be dropped by the outer
// IRI-resolution and IRI-GLOB filters, so we over-fetch to keep the post-join
// top-N stable. 5× is far more than typical drop-out (most blobs resolve to a
// resource with an `hm://` IRI), while still bounding the join fan-out.
const keywordSearchOversampleFactor = 5

// keywordSearchMaxOversample caps the inner CTE budget to keep the join work
// bounded even when callers pass very large limits.
const keywordSearchMaxOversample = 5000

// keywordSearchMinOversample is a floor so small `limit` values still leave
// headroom for the outer filters to drop a few rows.
const keywordSearchMinOversample = 200

// keywordSearch performs minimal FTS search returning SearchResultMap.
// This is a standalone function (not Server method) used for hybrid search.
func keywordSearch(conn *sqlite.Conn, query string, limit int, contentTypes map[string]bool, iriGlob string, publicOnly bool) (llm.SearchResultMap, error) {
	results := make(llm.SearchResultMap)
	var resourceTypeTitle, resourceTypeContact, resourceTypeDoc, resourceTypeComment, resourceTypeProfile interface{}
	supportedType := false
	if ok, val := contentTypes["title"]; ok && val {
		resourceTypeTitle = "title"
		supportedType = true
	}
	if ok, val := contentTypes["profile"]; ok && val {
		resourceTypeProfile = "profile"
		supportedType = true
	}
	if ok, val := contentTypes["contact"]; ok && val {
		resourceTypeContact = "contact"
		supportedType = true
	}
	if ok, val := contentTypes["document"]; ok && val {
		resourceTypeDoc = "document"
		supportedType = true
	}
	if ok, val := contentTypes["comment"]; ok && val {
		resourceTypeComment = "comment"
		supportedType = true
	}
	if !supportedType {
		return nil, fmt.Errorf("invalid content type filter: at least one of title, contact, document, comment, profile must be specified")
	}
	if len(contentTypes) == 0 {
		return nil, errors.New("at least one content type is required. Otherwise there is nothing to search :)")
	}
	score := float32(999999.9)

	// Oversample the inner CTE so the post-join filters (IRI resolution, GLOB)
	// can drop a few rows without shrinking the top-N visible to the caller.
	oversample := limit * keywordSearchOversampleFactor
	if oversample < keywordSearchMinOversample {
		oversample = keywordSearchMinOversample
	}
	if oversample > keywordSearchMaxOversample {
		oversample = keywordSearchMaxOversample
	}

	cb := func(stmt *sqlite.Stmt) error {
		// The query already handles proper ordering and limit. The order depends on type and rank.
		// We assign scores in decreasing order to be consistent with other search methods.
		results[stmt.ColumnInt64(0)] = score
		score--
		return nil
	}

	// Skip the per-row IRI GLOB when the caller passes the catch-all default —
	// every resource has an `hm://` IRI, so the predicate would just be evaluated
	// for nothing on every joined row.
	if iriGlob == "" || iriGlob == "hm://*" {
		if err := sqlitex.Exec(conn, qKeywordSearchAllIRIs(), cb,
			query, resourceTypeTitle, resourceTypeContact, resourceTypeDoc, resourceTypeComment, resourceTypeProfile,
			publicOnly, oversample, limit); err != nil {
			return nil, fmt.Errorf("keyword search failed: %w", err)
		}
		return results, nil
	}

	if err := sqlitex.Exec(conn, qKeywordSearch(), cb,
		query, resourceTypeTitle, resourceTypeContact, resourceTypeDoc, resourceTypeComment, resourceTypeProfile,
		publicOnly, oversample, iriGlob, limit); err != nil {
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

// qBatchDeletedComments checks deletion status for a batch of comments in one query.
// The parameter is a JSON array of objects: [{"author_id": N, "tsid": "..."}, ...]
// Returns one row per comment: (author_id INTEGER, tsid TEXT, is_deleted INTEGER).
//
// The batch CTE drives the join so the planner can probe the partial index
// `structural_blobs_by_tsid (extra_attrs->>'tsid', author) WHERE … IS NOT NULL`
// once per batch entry — without the INDEXED BY hint the planner falls back
// to `structural_blobs_by_type (type)`, which matches every Comment blob and
// is dramatically slower for small batches against a populated DB. ROW_NUMBER
// over the per-(author,tsid) partition replaces a per-outer-row correlated
// MAX(ts) subquery; the resulting is_deleted comes from the latest blob, same
// semantics as before.
var qBatchDeletedComments = dqb.Str(`
    WITH batch AS (
        SELECT CAST(je.value->>'author_id' AS INTEGER) AS author_id,
               je.value->>'tsid' AS tsid
        FROM json_each(?) je
    ),
    ranked AS (
        SELECT
            b.author_id,
            b.tsid,
            sb.extra_attrs->>'deleted' AS deleted_raw,
            ROW_NUMBER() OVER (
                PARTITION BY b.author_id, b.tsid
                ORDER BY sb.ts DESC
            ) AS rn
        FROM batch b
        JOIN structural_blobs sb INDEXED BY structural_blobs_by_tsid
          ON sb.extra_attrs->>'tsid' = b.tsid
         AND sb.author = b.author_id
        WHERE sb.type = 'Comment'
    )
    SELECT
        author_id,
        tsid,
        CASE WHEN deleted_raw = '1' THEN 1 ELSE 0 END AS is_deleted
    FROM ranked
    WHERE rn = 1;
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

// sanitizeSearchQuery strips characters from a raw search query that are not
// alphanumeric, underscore, or space, replacing them with spaces to match how
// FTS5's unicode61 tokenizer treats those characters as token separators.
// Multiple consecutive spaces are collapsed into one.
func sanitizeSearchQuery(raw string) string {
	re := regexp.MustCompile(`[^A-Za-z0-9_ ]+`)
	clean := re.ReplaceAllString(raw, " ")
	return strings.Join(strings.Fields(clean), " ")
}

// SearchResources implements the Fuzzy search of documents.
func (srv *Server) SearchResources(ctx context.Context, in *documents.SearchResourcesRequest) (*documents.SearchResourcesResponse, error) {
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
	cleanQuery := sanitizeSearchQuery(in.Query)
	if strings.ReplaceAll(cleanQuery, " ", "") == "" {
		return nil, nil
	}
	requestedPageSize := in.PageSize
	if in.PageSize == 0 {
		in.PageSize = 30
	}
	var bodyMatches []fuzzy.Match
	contentTypes := map[string]bool{}
	if len(in.ContentTypeFilter) > 0 {
		for _, ct := range in.ContentTypeFilter {
			switch ct {
			case documents.ContentTypeFilter_CONTENT_TYPE_TITLE:
				contentTypes["title"] = true
				contentTypes["profile"] = true
			case documents.ContentTypeFilter_CONTENT_TYPE_DOCUMENT:
				contentTypes["document"] = true
			case documents.ContentTypeFilter_CONTENT_TYPE_COMMENT:
				contentTypes["comment"] = true
			case documents.ContentTypeFilter_CONTENT_TYPE_CONTACT:
				contentTypes["contact"] = true
			}
		}
	} else {
		// Legacy fallback.
		contentTypes["title"] = true
		contentTypes["profile"] = true
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
	// Adjust candidate limit based on search type. If the caller requested a
	// page size, keep enough headroom for dedupe/deleted-result filtering but
	// avoid resolving hundreds of FTS rows for small interactive searches.
	resultsLmit := 300
	if in.SearchType == documents.SearchType_SEARCH_HYBRID || in.SearchType == documents.SearchType_SEARCH_SEMANTIC {
		resultsLmit = 200
	} else if len(cleanQuery) < 3 {
		resultsLmit = 100
	}
	if requestedPageSize > 0 {
		pageLimit := int(requestedPageSize) * 4
		if pageLimit < 40 {
			pageLimit = 40
		}
		resultsLmit = min(resultsLmit, pageLimit)
	}
	tokens := strings.Fields(cleanQuery)
	for i, t := range tokens {
		tokens[i] = `"` + t + `"`
	}
	ftsStrKeySearch := strings.Join(tokens, " ") + "*"
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
	publicOnly, err := srv.publicOnlyForIRIGlob(ctx, iriGlob)
	if err != nil {
		return nil, err
	}
	contextBefore := int(math.Ceil(float64(in.ContextSize) / 2.0))
	contextAfter := int(in.ContextSize) - contextBefore
	var numResults int = 0

	// Prepare variables for semantic/hybrid search
	query := cleanQuery

	winners := llm.SearchResultMap{}
	const semanticThreshold = 0.45 // 0.55 Minimum similarity for relevant results with granite-embedding-107m-multilingual model.

	// Check if semantic search is requested but embedder is not available.
	if srv.embedder == nil {
		switch in.SearchType {
		case documents.SearchType_SEARCH_SEMANTIC:
			return nil, status.Errorf(codes.Unavailable, "semantic search is not available: embedding service is disabled")
		case documents.SearchType_SEARCH_HYBRID:
			// Degrade to keyword-only when embedding service is not available.
			srv.log.Warn("Embedding service disabled, hybrid search falling back to keyword-only")
			in.SearchType = documents.SearchType_SEARCH_KEYWORD
		}
	}

	switch in.SearchType {
	case documents.SearchType_SEARCH_HYBRID:
		// Hybrid search: run semantic + keyword concurrently, blend with RRF
		var semanticResults, keywordResults llm.SearchResultMap
		var semanticErr, keywordErr error
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			semanticResults, semanticErr = srv.embedder.SemanticSearch(ctx, query, resultsLmit*3, contentTypes, iriGlob, semanticThreshold, publicOnly)
		}()
		go func() {
			defer wg.Done()
			keywordErr = srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
				var err error
				keywordResults, err = keywordSearch(conn, ftsStrKeySearch, resultsLmit*3, contentTypes, iriGlob, publicOnly)
				return err
			})
		}()
		wg.Wait()
		if keywordErr != nil {
			return nil, fmt.Errorf("keyword search failed: %w", keywordErr)
		}

		// On any semantic failure, fall back to keyword-only results instead of
		// failing the entire search. The keyword leg still provides useful results.
		if semanticErr != nil {
			srv.log.Warn("Semantic search failed in hybrid mode, falling back to keyword-only results",
				zap.Error(semanticErr), zap.String("query", query))
			winners = keywordResults
		} else {
			// Blend results with RRF.
			winners = blendSearchResults(semanticResults, keywordResults, resultsLmit*2, query)
		}

	case documents.SearchType_SEARCH_SEMANTIC:
		// Semantic-only search. Any failure is surfaced to the caller since there
		// is no keyword leg to fall back to.
		var err error
		winners, err = srv.embedder.SemanticSearch(ctx, query, resultsLmit*2, contentTypes, iriGlob, semanticThreshold, publicOnly)
		if err != nil {
			return nil, fmt.Errorf("semantic search failed: %w", err)
		}

	default:
		// Keyword only search:
		err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			var err error
			winners, err = keywordSearch(conn, ftsStrKeySearch, resultsLmit, contentTypes, iriGlob, publicOnly)
			return err
		})
		if err != nil {
			return nil, fmt.Errorf("keyword search failed: %w", err)
		}
	}
	// Short-circuit when there are no results to avoid running the expensive
	// resource resolution query with an empty input set.
	if len(winners) == 0 {
		return &documents.SearchResourcesResponse{}, nil
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
			if headsData := stmt.ColumnBytes(13); len(headsData) > 0 {
				if err := json.Unmarshal(headsData, &heads); err != nil {
					return err
				}
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
			case "profile":
				res.iri = res.docID
				// For profiles, the icon is in extra_attrs rather than document_generations metadata.
				if extraAttrs := stmt.ColumnBytes(18); len(extraAttrs) > 0 {
					var attrs struct {
						Icon string `json:"icon"`
					}
					if err := json.Unmarshal(extraAttrs, &attrs); err == nil && attrs.Icon != "" {
						icon.Icon.Value = attrs.Icon
					}
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

	// Trim results to a reasonable limit before expensive post-processing.
	// The version-upgrade heuristic and comment-deletion checks run per-result,
	// so processing 238 results when the client only needs 50 wastes ~100ms.
	// Co-sort searchResults and bodyMatches by score, then trim.
	if in.PageSize > 0 {
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
			return 0
		})

		sorted := make([]fullDataSearchResult, len(searchResults))
		sortedMatches := make([]fuzzy.Match, len(bodyMatches))
		for newIdx, oldIdx := range indices {
			sorted[newIdx] = searchResults[oldIdx]
			bm := bodyMatches[oldIdx]
			bm.Index = newIdx
			sortedMatches[newIdx] = bm
		}
		searchResults = sorted
		bodyMatches = sortedMatches

		// Trim to 2x page size for headroom against deleted/filtered results.
		limit := int(in.PageSize) * 2
		if limit < len(searchResults) {
			searchResults = searchResults[:limit]
			bodyMatches = bodyMatches[:limit]
		}
	}

	matchingResources := []*documents.ResourceSearchResult{}
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
	// Batch pre-fetch deletion status for all comments to avoid N+1 queries.
	type commentBatchEntry struct {
		AuthorID int64  `json:"author_id"`
		Tsid     string `json:"tsid"`
	}
	commentDeletedMap := make(map[commentIdentifier]bool)
	{
		var commentBatch []commentBatchEntry
		for _, match := range bodyMatches {
			r := searchResults[match.Index]
			if r.contentType == "comment" && (r.commentKey.authorID != 0 || r.commentKey.tsid != "") {
				commentBatch = append(commentBatch, commentBatchEntry{
					AuthorID: r.commentKey.authorID,
					Tsid:     r.commentKey.tsid,
				})
			}
		}
		if len(commentBatch) > 0 {
			batchJSON, err := json.Marshal(commentBatch)
			if err != nil {
				return nil, fmt.Errorf("failed to marshal comment batch: %w", err)
			}
			if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
				return sqlitex.Exec(conn, qBatchDeletedComments(), func(stmt *sqlite.Stmt) error {
					key := commentIdentifier{
						authorID: stmt.ColumnInt64(0),
						tsid:     stmt.ColumnText(1),
					}
					commentDeletedMap[key] = stmt.ColumnInt(2) == 1
					return nil
				}, string(batchJSON))
			}); err != nil {
				return nil, err
			}
		}
	}

	finalResults := []fullDataSearchResult{}
	for _, match := range bodyMatches {
		if searchResults[match.Index].isDeleted {
			// Skip deleted resources
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
		if searchResults[match.Index].version != "" &&
			searchResults[match.Index].contentType != "comment" &&
			searchResults[match.Index].contentType != "profile" {
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
				relatedFound := false
				err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
					return sqlitex.Exec(conn, qGetLatestBlockChange(), func(stmt *sqlite.Stmt) error {
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
		} else if searchResults[match.Index].contentType == "comment" {
			isDeleted := commentDeletedMap[searchResults[match.Index].commentKey]
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
	slices.SortFunc(finalResults, orderBySimilarity)
	for _, match := range finalResults {
		matchingResources = append(matchingResources, &documents.ResourceSearchResult{
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
		if cursor.Offset >= len(matchingResources) {
			matchingResources = nil
		} else {
			end := cursor.Offset + int(in.PageSize)
			if end < len(matchingResources) {
				nextCursor := struct {
					Offset int `json:"o"`
				}{Offset: end}
				nextPageToken = apiutil.EncodePageToken(nextCursor, nil)
				matchingResources = matchingResources[cursor.Offset:end]
			} else {
				matchingResources = matchingResources[cursor.Offset:]
			}
		}
	}

	return &documents.SearchResourcesResponse{
		Resources:     matchingResources,
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

	// 2) then titles and profiles
	isTitleLikeA := a.contentType == "title" || a.contentType == "profile"
	isTitleLikeB := b.contentType == "title" || b.contentType == "profile"
	if isTitleLikeA != isTitleLikeB {
		if isTitleLikeA {
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

// orderBySimilarity sorts resources by similarity score descending (higher scores first).
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

// DeleteResource implements the corresponding gRPC method.
// func (api *Server) DeleteResource(ctx context.Context, in *documents.DeleteResourceRequest) (*emptypb.Empty, error) {
// 	var meta string
// 	var qGetResourceMetadata = dqb.Str(`
//   	SELECT meta from meta_view
// 	WHERE iri = :eid
// 	`)

// 	if in.Id == "" {
// 		return nil, status.Errorf(codes.InvalidArgument, "must specify resource ID to delete")
// 	}

// 	eid := hyper.ResourceID(in.Id)

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

// 	err = api.blobs.DeleteResource(ctx, eid)
// 	if err != nil {
// 		if errors.Is(err, hyper.ErrResourceNotFound) {
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
// 			res, err := hypersql.ResourcesInsertRemovedRecord(conn, eid.String(), in.Reason, meta)
// 			if err != nil {
// 				return err
// 			}
// 			if res.ResourceEID != eid.String() {
// 				return fmt.Errorf("%w: %s", hyper.ErrResourceNotFound, eid)
// 			}

// 			return nil
// 		})
// 	})
// 	return &emptypb.Empty{}, err
// }

// // UndeleteResource implements the corresponding gRPC method.
// func (api *Server) UndeleteResource(ctx context.Context, in *documents.UndeleteResourceRequest) (*emptypb.Empty, error) {
// 	if in.Id == "" {
// 		return nil, status.Errorf(codes.InvalidArgument, "must specify resource ID to restore")
// 	}

// 	eid := hyper.ResourceID(in.Id)

// 	return &emptypb.Empty{}, api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		return hypersql.ResourcesDeleteRemovedRecord(conn, eid.String())
// 	})
// }

// // ListDeletedResources implements the corresponding gRPC method.
// func (api *Server) ListDeletedResources(ctx context.Context, _ *documents.ListDeletedResourcesRequest) (*documents.ListDeletedResourcesResponse, error) {
// 	resp := &documents.ListDeletedResourcesResponse{
// 		DeletedResources: make([]*documents.DeletedResource, 0),
// 	}

// 	err := api.blobs.Query(ctx, func(conn *sqlite.Conn) error {
// 		list, err := hypersql.ResourcesListRemovedRecords(conn)
// 		if err != nil {
// 			return err
// 		}
// 		for _, resource := range list {
// 			resp.DeletedResources = append(resp.DeletedResources, &documents.DeletedResource{
// 				Id:            resource.DeletedResourcesIRI,
// 				DeleteTime:    &timestamppb.Timestamp{Seconds: resource.DeletedResourcesDeleteTime},
// 				DeletedReason: resource.DeletedResourcesReason,
// 				Metadata:      resource.DeletedResourcesMeta,
// 			})
// 		}
// 		return nil
// 	})

//		return resp, err
//	}
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
