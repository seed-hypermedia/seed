package documents

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/url"
	"regexp"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hlc"
	"seed/backend/hmnet/netutil"
	"seed/backend/hmnet/syncing"
	"seed/backend/util/dqb"
	"seed/backend/util/errutil"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"slices"
	"strconv"
	"strings"

	"github.com/fxamacker/cbor/v2"
	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	gonanoid "github.com/matoous/go-nanoid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// HmRe is the regular expression to parse IRIS with versions and latest flag.
var HmRe = regexp.MustCompile(
	`^hm://` +
		`(?P<account>[A-Za-z0-9]+)` + // account (required)
		`(?P<path>/[^?#]+)?` + // path (optional, starts with /)
		`(?:\?v=(?P<version>[A-Za-z0-9-_@/]+))?` + // version (optional)
		`(?P<latest>&l)?$`, // latest flag (optional)
)

// ListCitations implements the corresponding gRPC method.
func (srv *Server) ListCitations(ctx context.Context, in *documents.ListCitationsRequest) (*documents.ListCitationsResponse, error) {
	if in.Iri == "" {
		return nil, errutil.MissingArgument("iri")
	}

	targetURL, err := url.Parse(in.Iri)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse IRI '%s': %v", in.Iri, err)
	}
	if targetURL.Scheme != "hm" || targetURL.Host == "" {
		return nil, status.Errorf(codes.InvalidArgument, "expected hm:// resource IRI, got '%s'", in.Iri)
	}

	targetAccount, err := core.DecodePrincipal(targetURL.Host)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse account '%s': %v", targetURL.Host, err)
	}

	var cursor citationsCursor
	if in.PageToken != "" {
		if err := cursor.FromString(in.PageToken); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "failed to decode page token: %v", err)
		}
	}

	if in.ReverseOrder && in.PageToken == "" {
		cursor.BlobID = math.MaxInt64
		cursor.LinkID = math.MaxInt64
	}

	if in.PageSize == 0 {
		in.PageSize = 10
	}

	publicOnly, err := srv.isPublicOnlyFor(ctx, targetAccount, targetURL.Path)
	if err != nil {
		return nil, err
	}

	resp := &documents.ListCitationsResponse{}
	var genesisBlobIDs []string
	var deletedList []string
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		var eid int64
		if err := sqlitex.Exec(conn, qResourceLookupID(), func(stmt *sqlite.Stmt) error {
			eid = stmt.ColumnInt64(0)
			return nil
		}, in.Iri); err != nil {
			return err
		}

		commentExists, err := citationCommentExists(conn, in.Iri)
		if err != nil {
			return err
		}

		if eid == 0 && !commentExists {
			return status.Errorf(codes.NotFound, "resource '%s' is not found", in.Iri)
		}

		var lastCursor citationsCursor
		var count int32
		if err := sqlitex.Exec(conn, qListCitations(in.ReverseOrder), func(stmt *sqlite.Stmt) error {
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
				citationType  = stmt.ColumnText(13)
				isDeleted     = stmt.ColumnText(15) == "1"
			)
			genesisBlobIDs = append(genesisBlobIDs, strconv.FormatInt(stmt.ColumnInt64(14), 10))
			lastCursor.BlobID = stmt.ColumnInt64(10)
			lastCursor.LinkID = stmt.ColumnInt64(11)

			if source == "" && blobType != "Comment" {
				return fmt.Errorf("BUG: missing source for citation of type '%s'", blobType)
			}

			if blobType == "Comment" {
				ts = tsid.Timestamp()
				sourceDoc = source
				source = "hm://" + author + "/" + tsid.String()
			}
			if isDeleted {
				deletedList = append(deletedList, source)
			}

			resp.Citations = append(resp.Citations, &documents.Citation{
				Source:        source,
				SourceType:    blobType,
				SourceContext: anchor,
				SourceBlob: &documents.Citation_BlobInfo{
					Cid:        sourceBlob,
					Author:     author,
					CreateTime: timestamppb.New(ts),
				},
				SourceDocument: sourceDoc,
				Target:         in.Iri,
				TargetVersion:  targetVersion,
				IsExactVersion: isPinned,
				TargetFragment: fragment,
				CitationType:   citationType,
			})

			return nil
		}, eid, publicOnly, cursor.BlobID, cursor.LinkID, in.PageSize); err != nil {
			return err
		}

		return nil
	}); err != nil {
		return nil, err
	}

	genesisBlobJSON := "[" + strings.Join(genesisBlobIDs, ",") + "]"
	var movedResources []citationMovedResource
	err = srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qCitationMovedResources(), func(stmt *sqlite.Stmt) error {
			movedResources = append(movedResources, citationMovedResource{
				NewIRI:    stmt.ColumnText(0),
				OldIRI:    stmt.ColumnText(1),
				IsDeleted: stmt.ColumnInt(2) == 1,
			})
			return nil
		}, genesisBlobJSON)
	})
	if err != nil {
		return nil, err
	}
	for _, movedResource := range movedResources {
		for i, result := range resp.Citations {
			if result.Source == movedResource.OldIRI {
				resp.Citations[i].Source = movedResource.NewIRI
			}
		}
	}

	seenCitations := make(map[string]bool)
	uniqueCitations := make([]*documents.Citation, 0, len(resp.Citations))
	for _, citation := range resp.Citations {
		key := fmt.Sprintf("%s|%s|%s|%s|%t", citation.Source, citation.SourceType, citation.TargetVersion, citation.TargetFragment, citation.IsExactVersion)
		if !seenCitations[key] && !slices.Contains(deletedList, citation.Source) {
			seenCitations[key] = true
			uniqueCitations = append(uniqueCitations, citation)
		}
	}
	resp.Citations = uniqueCitations
	if err := srv.addTargetBlockRevisions(ctx, in.Iri, targetAccount, targetURL.Path, resp.Citations); err != nil {
		return nil, err
	}

	return resp, nil
}

// PushResourcesToPeer implements the corresponding gRPC method.
func (srv *Server) PushResourcesToPeer(req *documents.PushResourcesToPeerRequest, stream grpc.ServerStreamingServer[p2p.AnnounceBlobsProgress]) error {
	ctx := stream.Context()

	dkeys := make(map[syncing.DiscoveryKey]struct{}, len(req.Resources))
	spaces := make(map[core.PrincipalUnsafeString]struct{})
	for _, res := range req.Resources {
		u, err := url.Parse(res)
		if err != nil {
			return fmt.Errorf("failed to parse resource URL: %w", err)
		}

		if u.Scheme != "hm" {
			return fmt.Errorf("unsupported resource scheme: %s", u.Scheme)
		}

		space, err := core.DecodePrincipal(u.Host)
		if err != nil {
			return fmt.Errorf("failed to decode principal: %w", err)
		}

		path := u.Path

		iri, err := blob.NewIRI(space, path)
		if err != nil {
			return fmt.Errorf("failed to create IRI: %w", err)
		}

		dkeys[syncing.DiscoveryKey{IRI: iri}] = struct{}{}
		spaces[space.UnsafeString()] = struct{}{}
	}

	// We want to support connecting to plain peer IDs, so we need to convert it into multiaddr.
	if len(req.Addrs) == 1 {
		addr := req.Addrs[0]
		if !strings.Contains(addr, "/") {
			req.Addrs[0] = "/p2p/" + addr
		}
	}

	info, err := netutil.AddrInfoFromStrings(req.Addrs...)
	if err != nil {
		return fmt.Errorf("failed to parse multiaddr: %w", err)
	}

	// Determine which spaces' private blobs we can share with the target peer.
	// We only include private blobs for spaces where the target peer is the siteURL server.
	// For other spaces, only public blobs are included.
	var authorizedSpaces []core.Principal
	for x := range spaces {
		space := x.Unwrap()
		siteURL, err := srv.idx.GetSiteURL(ctx, space)
		if err != nil || siteURL == "" {
			continue
		}
		// Check if the target peer matches the siteURL server.
		// We need to resolve siteURL to peer ID via HTTP.
		resolvedInfo, err := srv.idx.ResolveSiteURL(ctx, siteURL)
		if err != nil {
			continue
		}
		if resolvedInfo.ID == info.ID {
			authorizedSpaces = append(authorizedSpaces, space)
		}
	}

	// Get related material with proper authorization.
	// If authorizedSpaces is empty, only public blobs are included.
	// If authorizedSpaces has entries, those spaces' private blobs are also included.
	var cids []syncing.CIDWithTS
	if err := srv.db.WithSaveTempOnly(ctx, func(conn *sqlite.Conn) (err error) {
		cids, err = syncing.GetRelatedMaterial(conn, dkeys, true, authorizedSpaces)
		return err
	}); err != nil {
		return err
	}

	// Convert CIDs to cid.Cid slice for allowlist.
	cidList := make([]cid.Cid, len(cids))
	for i, c := range cids {
		cidList[i] = c.CID
	}

	requestID := gonanoid.Must(16)
	// Allowlist the blobs for this peer during the push operation.
	srv.idx.AddAllowlist(info.ID, requestID, cidList)
	defer srv.idx.RemoveAllowlist(info.ID, requestID)

	request := &p2p.AnnounceBlobsRequest{
		Cids: make([]string, len(cids)),
	}
	for i, c := range cids {
		request.Cids[i] = c.CID.String()
	}

	syncClient, err := srv.p2p.SyncingClient(ctx, info.ID, info.Addrs...)
	if err != nil {
		return fmt.Errorf("could not get p2p client: %w", err)
	}

	streamRx, err := syncClient.AnnounceBlobs(ctx, request)
	if err != nil {
		return fmt.Errorf("failed to start AnnounceBlobs RPC: %w", err)
	}

	for {
		progIn, err := streamRx.Recv()
		if errors.Is(err, io.EOF) {
			_ = stream.Send(progIn) // ignore send error on termination
			return nil
		}
		if err != nil {
			return err
		}
		if err := stream.Send(progIn); err != nil {
			return err
		}
	}
}

// GetResource implements the corresponding gRPC method.
func (srv *Server) GetResource(ctx context.Context, in *documents.GetResourceRequest) (*documents.Resource, error) {
	u, err := url.Parse(in.Iri)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse IRI '%s': %v", in.Iri, err)
	}

	supportedSchemes := []string{"hm", "http", "https"}
	if !slices.Contains(supportedSchemes, u.Scheme) {
		return nil, status.Errorf(codes.InvalidArgument, "only %v schemes are supported: got '%s'", supportedSchemes, u.Scheme)
	}

	// Resolve web URLs to account IDs.
	if u.Scheme == "http" || u.Scheme == "https" {
		// Check if the path starts with /hm/<account-id> - if so, extract directly.
		if strings.HasPrefix(u.Path, "/hm/") {
			rest := u.Path[4:] // Remove "/hm/" prefix.
			// The account ID is the first path component after /hm/.
			slashIdx := strings.Index(rest, "/")
			var accountID, remainingPath string
			if slashIdx == -1 {
				accountID = rest
				remainingPath = ""
			} else {
				accountID = rest[:slashIdx]
				remainingPath = rest[slashIdx:]
			}
			u.Scheme = "hm"
			u.Host = accountID
			u.Path = remainingPath
		} else {
			// Resolve account ID via site config endpoint.
			siteURL := u.Scheme + "://" + u.Host
			siteConfig, err := srv.idx.ResolveSiteConfig(ctx, siteURL)
			if err != nil {
				return nil, status.Errorf(codes.NotFound, "failed to resolve site config for '%s': %v", siteURL, err)
			}
			if siteConfig.RegisteredAccountUID == "" {
				return nil, status.Errorf(codes.NotFound, "site '%s' has no registered account", siteURL)
			}
			u.Scheme = "hm"
			u.Host = siteConfig.RegisteredAccountUID
		}
	}

	acc, err := core.DecodePrincipal(u.Host)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse account '%s': %v", u.Host, err)
	}

	uq := u.Query()
	versionRaw := blob.Version(uq.Get("v"))
	if versionRaw != "" && uq.Has("l") {
		// When `l` query parameter is present we want the latest version,
		// and at least the one specified by `v`. But currently we don't have a way
		// to express that in the backend, so we simply get the latest version we know about.
		versionRaw = ""
	}

	heads, err := versionRaw.Parse()
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse version '%s': %v", versionRaw, err)
	}

	if u.Path != "" {
		tsid := blob.TSID(u.Path[1:])

		// Notice that we don't care about the error here.
		// If the path is a not a TSID we will just treat it as a document path.
		if _, _, err := tsid.Parse(); err == nil {
			blb, err := srv.getSnapshotResource(ctx, acc, tsid, heads)
			if err != nil {
				return nil, err
			}

			switch v := blb.Blob.(type) {
			case *blob.Comment:
				if v.Visibility == blob.VisibilityPrivate {
					if err := srv.denyPrivateComment(ctx, v.Space(), v.Path); err != nil {
						return nil, err
					}
				}

				var cmt *documents.Comment
				if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
					lc := blob.NewLookupCache(conn)
					v, err := commentToProto(lc, blb.CID, v, tsid)
					cmt = v
					return err
				}); err != nil {
					return nil, err
				}

				return &documents.Resource{
					Kind: &documents.Resource_Comment{
						Comment: cmt,
					},
					Version: cmt.Version,
				}, nil
			case *blob.Contact:
				pb := contactToProto(tsid, v)
				return &documents.Resource{
					Kind: &documents.Resource_Contact{
						Contact: pb,
					},
				}, nil
			}
		}
	}

	// If we reach here, we assume the path is a document path.

	doc, err := srv.loadDocument(ctx, acc, u.Path, heads, false)
	if err != nil {
		return nil, err
	}

	if doc.Visibility() == blob.VisibilityPrivate {
		if err := srv.denyPrivateDocument(ctx, acc, u.Path); err != nil {
			return nil, err
		}
	}

	iri, err := makeIRI(acc, u.Path)
	if err != nil {
		return nil, err
	}

	docpb, err := srv.hydrated.get(ctx, string(iri), doc)
	if err != nil {
		return nil, err
	}

	return &documents.Resource{
		Kind: &documents.Resource_Document{
			Document: docpb,
		},
		Version: docpb.Version,
	}, nil
}

func (srv *Server) addTargetBlockRevisions(ctx context.Context, target string, account core.Principal, path string, citations []*documents.Citation) error {
	cache := make(map[string]map[string]string)
	for _, citation := range citations {
		if citation.TargetVersion == "" || citation.TargetFragment == "" {
			continue
		}

		blockID := blockIDFromCitationFragment(citation.TargetFragment)
		if blockID == "" {
			continue
		}

		revisions, ok := cache[citation.TargetVersion]
		if !ok {
			var err error
			revisions, err = srv.targetBlockRevisionsAtVersion(ctx, account, path, citation.TargetVersion)
			if err != nil {
				if status.Code(err) == codes.NotFound || status.Code(err) == codes.FailedPrecondition {
					revisions = map[string]string{}
				} else {
					return fmt.Errorf("failed to load target block revisions for %s at %s: %w", target, citation.TargetVersion, err)
				}
			}
			cache[citation.TargetVersion] = revisions
		}

		citation.TargetBlockRevision = revisions[blockID]
	}

	return nil
}

func blockIDFromCitationFragment(fragment string) string {
	if idx := strings.IndexByte(fragment, '['); idx >= 0 {
		fragment = fragment[:idx]
	}

	return strings.TrimSuffix(fragment, "+")
}

func (srv *Server) targetBlockRevisionsAtVersion(ctx context.Context, account core.Principal, path string, version string) (map[string]string, error) {
	heads, err := blob.Version(version).Parse()
	if err != nil {
		return nil, err
	}

	doc, err := srv.loadDocument(ctx, account, path, heads, false)
	if err != nil {
		return nil, err
	}

	hydrated, err := doc.Hydrate(ctx)
	if err != nil {
		return nil, err
	}

	revisions := make(map[string]string)
	collectCitationBlockRevisions(revisions, hydrated.Content)
	return revisions, nil
}

func collectCitationBlockRevisions(out map[string]string, nodes []*documents.BlockNode) {
	for _, node := range nodes {
		if node.GetBlock() != nil {
			out[node.Block.Id] = node.Block.Revision
		}
		collectCitationBlockRevisions(out, node.Children)
	}
}

func citationCommentExists(conn *sqlite.Conn, id string) (bool, error) {
	rid, err := blob.DecodeRecordID(strings.TrimPrefix(id, "hm://"))
	if err != nil {
		return false, nil
	}

	var exists bool
	err = sqlitex.Exec(conn, qCitationCommentExists(), func(stmt *sqlite.Stmt) error {
		exists = stmt.ColumnInt(0) > 0
		return nil
	}, rid.Authority, rid.TSID.String())
	if err != nil {
		return false, err
	}

	return exists, nil
}

type citationMovedResource struct {
	NewIRI    string
	OldIRI    string
	IsDeleted bool
}

type citationsCursor struct {
	BlobID int64 `json:"b"`
	LinkID int64 `json:"l"`
}

func (cc *citationsCursor) FromString(s string) error {
	data, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return err
	}

	return json.Unmarshal(data, cc)
}

func (cc citationsCursor) String() string {
	if cc.BlobID == 0 && cc.LinkID == 0 {
		return ""
	}

	data, err := json.Marshal(cc)
	if err != nil {
		panic(err)
	}

	return base64.RawURLEncoding.EncodeToString(data)
}

var qResourceLookupID = dqb.Str(`
	SELECT resources.id
	FROM resources
	WHERE resources.iri = :resource_iri
	LIMIT 1
`)

var qCitationCommentExists = dqb.Str(`
	SELECT 1
	FROM structural_blobs sb
	JOIN public_keys pk ON pk.id = sb.author
	WHERE sb.type = 'Comment'
	AND pk.principal = :authority
	AND sb.extra_attrs->>'tsid' = :tsid
	AND sb.extra_attrs->>'deleted' IS NULL
	LIMIT 1
`)

var qCitationMovedResources = dqb.Str(`
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

const qListCitationsTpl = `
WITH RECURSIVE
latest_document_generations AS (
  SELECT dg.*
  FROM document_generations dg
  GROUP BY dg.resource
  HAVING dg.generation = MAX(dg.generation)
),
redirect_ancestors(resource, iri, depth) AS (
  SELECT r.id, r.iri, 0
  FROM resources r
  LEFT JOIN latest_document_generations dg ON dg.resource = r.id
  WHERE r.id = :target
  AND (dg.metadata IS NULL OR dg.metadata->>'$."$db.redirect".v' IS NULL)

  UNION ALL

  SELECT r.id, r.iri, ra.depth + 1
  FROM redirect_ancestors ra
  JOIN latest_document_generations dg
    ON dg.metadata->>'$."$db.redirect".v' = ra.iri
  JOIN resources r ON r.id = dg.resource
  WHERE r.iri != ra.iri
  AND ra.depth < 16
),
changes AS (
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
LEFT JOIN public_blobs pb3 ON pb3.id = blobs.id
WHERE resource_links.target = :target
AND structural_blobs.type IN ('Change')
AND (:publicOnly = 0 OR pb3.id IS NOT NULL)
)
SELECT
    (SELECT iri FROM redirect_ancestors WHERE depth = 0) AS source_iri,
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
LEFT JOIN public_blobs pb ON pb.id = blobs.id
WHERE resource_links.target IN (SELECT resource FROM redirect_ancestors)
AND (blobs.id %s :blob_id OR (blobs.id = :blob_id AND resource_links.id %s :link_id))
AND structural_blobs.type IN ('Comment')
AND (:publicOnly = 0 OR pb.id IS NOT NULL)
GROUP BY source_iri, link_id, target_version, target_fragment

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
LEFT JOIN public_blobs pb2 ON pb2.id = blobs.id
JOIN changes ON (((changes.genesis_blob = structural_blobs.genesis_blob OR changes.id = structural_blobs.genesis_blob) AND structural_blobs.type = 'Ref') OR (changes.id = structural_blobs.id AND structural_blobs.type = 'Comment'))
AND (blobs.id %s :blob_id OR (blobs.id = :blob_id AND changes.link_id %s :link_id))
AND (:publicOnly = 0 OR pb2.id IS NOT NULL)
GROUP BY resources.iri, changes.link_id, target_version, target_fragment
ORDER BY blob_id %s, link_id %s
LIMIT :page_size + 1;
`

func qListCitations(desc bool) string {
	if desc {
		return qListCitationsDesc()
	}

	return qListCitationsAsc()
}

var qListCitationsAsc = dqb.Q(func() string {
	return fmt.Sprintf(qListCitationsTpl, ">", ">", ">", ">", "ASC", "ASC")
})

var qListCitationsDesc = dqb.Q(func() string {
	return fmt.Sprintf(qListCitationsTpl, "<", "<", "<", "<", "DESC", "DESC")
})

type snapshotBlob struct {
	CID cid.Cid

	blob.Blob
}

func (srv *Server) getSnapshotResource(ctx context.Context, authority core.Principal, tsid blob.TSID, version []cid.Cid) (*snapshotBlob, error) {
	// For state-based (snapshot style) blobs we only support a single version for now,
	// so if version is specified we just get the blob corresponding to that CID.
	if len(version) == 1 {
		c := version[0]
		blk, err := srv.idx.Get(ctx, c)
		if err != nil {
			return nil, err
		}

		var union struct {
			Type blob.Type `cbor:"type"`
		}

		if err := cbor.Unmarshal(blk.RawData(), &union); err != nil {
			return nil, fmt.Errorf("failed to parse blob union discriminant type")
		}

		out, err := decodeSnapshotBlob(union.Type, blk.RawData())
		if err != nil {
			return nil, err
		}

		tsidReal := blob.NewTSID(out.BlobTime(), blk.RawData())
		if tsid != tsidReal {
			return nil, status.Errorf(codes.InvalidArgument, "getResource: blob TSID '%s' does not match requested TSID '%s'", tsid, tsidReal)
		}

		return &snapshotBlob{
			Blob: out,
			CID:  blk.Cid(),
		}, nil
	}

	if len(version) > 1 {
		return nil, status.Errorf(codes.InvalidArgument, "multiple versions are not supported for state-based resources: got %d versions", len(version))
	}

	var (
		out blob.Blob
		c   cid.Cid
	)

	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) (err error) {
		rows, discard, check := sqlitex.Query(conn, qGetResource(), authority, tsid).All()
		defer discard(&err)
		for row := range rows {
			seq := sqlite.NewIncrementor(0)
			var (
				btype      = blob.Type(row.ColumnText(seq()))
				codec      = uint64(row.ColumnInt64(seq()))
				hash       = row.ColumnBytesUnsafe(seq())
				dataZipped = row.ColumnBytesUnsafe(seq())
				size       = row.ColumnInt64(seq())
			)
			c = cid.NewCidV1(codec, hash)
			data := make([]byte, 0, size)
			data, err := srv.idx.Decompress(dataZipped, data)
			if err != nil {
				return err
			}

			out, err = decodeSnapshotBlob(btype, data)
			if err != nil {
				return err
			}
		}
		return check()
	}); err != nil {
		return nil, err
	}

	return &snapshotBlob{
		CID:  c,
		Blob: out,
	}, nil
}

var qGetResource = dqb.Str(`
	SELECT
		sb.type,
		b.codec,
		b.multihash,
		b.data,
		b.size
	FROM structural_blobs sb
	JOIN blobs b ON b.id = sb.id
	WHERE sb.author = (SELECT id FROM public_keys WHERE principal = :authority)
	AND sb.extra_attrs->>'tsid' = :tsid
	AND b.size > 0
	LIMIT 1
`)

func decodeSnapshotBlob(bt blob.Type, data []byte) (blob.Blob, error) {
	var out blob.Blob
	switch bt {
	case blob.TypeComment:
		out = &blob.Comment{}
	case blob.TypeContact:
		out = &blob.Contact{}
	default:
		return nil, status.Errorf(codes.InvalidArgument, "getResource: blob type '%s' is not supported", bt)
	}

	if err := cbornode.DecodeInto(data, out); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to decode blob: %v", err)
	}

	return out, nil
}
