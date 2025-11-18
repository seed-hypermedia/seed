package documents

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/hmnet/syncing"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"slices"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// PushResourcesToPeer implements the corresponding gRPC method.
func (srv *Server) PushResourcesToPeer(req *documents.PushResourcesToPeerRequest, streamTx grpc.ServerStreamingServer[documents.SyncingProgress]) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	prog := syncing.NewDiscoveryProgress()
	prog.StartNotifier(ctx, 100*time.Millisecond)
	prog.Notify()
	conn, cancel, err := srv.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("failed to acquire db connection: %w", err)
	}
	defer cancel()
	dkeys := make(map[syncing.DiscoveryKey]struct{}, len(req.Resources))
	for _, res := range req.Resources {
		m := syncing.HmRe.FindStringSubmatch(res)
		if m == nil {
			return fmt.Errorf("invalid resource format: %s", res)
		}
		result := map[string]string{}
		for i, name := range syncing.HmRe.SubexpNames() {
			if i == 0 || name == "" {
				continue
			}
			result[name] = m[i]
		}
		if _, ok := result["account"]; !ok || result["account"] == "" {
			return fmt.Errorf("resource missing account: %s", res)
		}
		if _, ok := result["path"]; !ok {
			result["path"] = ""
		}
		resource := "hm://" + result["account"] + result["path"]
		dkeys[syncing.DiscoveryKey{IRI: blob.IRI(resource)}] = struct{}{}
	}
	cids, err := syncing.GetRelatedMaterial(conn, dkeys, true)
	if err != nil {
		return err
	}
	request := &p2p.FetchBlobsRequest{}
	for cid := range cids {
		request.Cids = append(request.Cids, cid.String())
	}

	pid, err := peer.Decode(req.Pid)
	if err != nil {
		return fmt.Errorf("failed to decode peer ID '%s': %w", req.Pid, err)
	}
	syncClient, err := srv.sync.SyncingClient(ctx, pid)
	if err != nil {
		return fmt.Errorf("could not get p2p client: %w", err)
	}
	streamRx, err := syncClient.FetchBlobs(ctx, request)
	if err != nil {
		return fmt.Errorf("failed to start FetchBlobs RPC: %w", err)
	}

	for {
		progIn, err := streamRx.Recv()
		if errors.Is(err, io.EOF) {
			_ = streamTx.Send(progIn) // ignore send error on termination
			return nil
		}
		if err != nil {
			return err
		}
		if err := streamTx.Send(progIn); err != nil {
			return err
		}
	}
	/*
		errCh := make(chan error, 1)
		go func() {
			errCh <- srv.sync.FetchBlobs(request, stream)
		}()
			for {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case syncErr := <-errCh:
					// final progress snapshot before returning
					out := &documents.SyncingProgress{
						PeersFound:      prog.PeersFound.Load(),
						PeersSyncedOk:   prog.PeersSyncedOK.Load(),
						PeersFailed:     prog.PeersFailed.Load(),
						BlobsDiscovered: prog.BlobsDiscovered.Load(),
						BlobsDownloaded: prog.BlobsDownloaded.Load(),
						BlobsFailed:     prog.BlobsFailed.Load(),
					}
					_ = streamTx.Send(out) // ignore send error on termination
					return syncErr
				case <-prog.Updates():
					out := &documents.SyncingProgress{
						PeersFound:      prog.PeersFound.Load(),
						PeersSyncedOk:   prog.PeersSyncedOK.Load(),
						PeersFailed:     prog.PeersFailed.Load(),
						BlobsDiscovered: prog.BlobsDiscovered.Load(),
						BlobsDownloaded: prog.BlobsDownloaded.Load(),
						BlobsFailed:     prog.BlobsFailed.Load(),
					}
					if err := streamTx.Send(out); err != nil {
						return err
					}
				}
			}
	*/
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

	if u.Scheme != "hm" {
		return nil, status.Errorf(codes.Unimplemented, "only 'hm' scheme is supported for now")
	}

	acc, err := core.DecodePrincipal(u.Host)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse account '%s': %v", u.Host, err)
	}

	versionRaw := blob.Version(u.Query().Get("v"))
	if versionRaw != "" && u.Query().Has("l") {
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

	docpb, err := doc.Hydrate(ctx)
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
		rows, discard, check := sqlitex.Query(conn, qGetResource(), authority, tsid)
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
