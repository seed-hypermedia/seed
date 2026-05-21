package networking

import (
	"context"
	"fmt"
	"math"
	"net/netip"
	networking "seed/backend/genproto/networking/v1alpha"
	"seed/backend/hmnet"
	"seed/backend/hmnet/netutil"
	"seed/backend/ipfs"
	"seed/backend/util/apiutil"
	"seed/backend/util/dqb"
	"strings"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/libp2p/go-libp2p/core/peer"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Server implements the networking API.
type Server struct {
	net *hmnet.Node
	db  *sqlitex.Pool
	log *zap.Logger
}

type peerExtra struct {
	createdTS *timestamppb.Timestamp
	updatedTS *timestamppb.Timestamp
	isDirect  bool
}

// NewServer returns a new networking API server.
func NewServer(node *hmnet.Node, db *sqlitex.Pool, log *zap.Logger) *Server {
	return &Server{
		net: node,
		db:  db,
		log: log,
	}
}

// RegisterServer registers the server with the gRPC server.
func (srv *Server) RegisterServer(rpc grpc.ServiceRegistrar) {
	networking.RegisterNetworkingServer(rpc, srv)
}

// Connect implements the Connect RPC method.
func (srv *Server) Connect(ctx context.Context, in *networking.ConnectRequest) (*networking.ConnectResponse, error) {
	// We want to support connecting to plain peer IDs, so we need to convert it into multiaddr.
	if len(in.Addrs) == 1 {
		addr := in.Addrs[0]
		if !strings.Contains(addr, "/") {
			in.Addrs[0] = "/p2p/" + addr
		}
	}

	info, err := netutil.AddrInfoFromStrings(in.Addrs...)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "Can't connect due to bad addrs: %v", err)
	}

	net := srv.net

	if err := net.ForceConnect(ctx, info); err != nil {
		return nil, err
	}

	return &networking.ConnectResponse{}, nil
}

// qListPeers intentionally omits the addresses column. The desktop UI's
// list-of-peers view renders only id/connection-status/protocol; consumers
// that genuinely need multiaddrs (settings detail panels, the
// "Copy Addresses" action) call the per-peer GetPeerInfo endpoint, which
// reads from libp2p's in-memory Peerstore and falls back to peers.addresses
// for gossip-only peers. Keeping the list projection narrow removes a
// fat-TEXT column scan from a poll-every-15s call path and lets PageSize
// stay unbounded — production saw the prior query at 1.01 s p99 because the
// frontend's BIG_INT (2^25) PageSize forced reading all addresses for
// thousands of rows.
var qListPeers = dqb.Str(`
	SELECT
		id,
		pid,
		explicitly_connected,
		created_at,
		updated_at
	FROM peers
	WHERE id < :last_cursor
	ORDER BY id DESC LIMIT :page_size;
`)

// ListPeers filters peers by status. If no status provided, it lists all peers.
func (srv *Server) ListPeers(ctx context.Context, in *networking.ListPeersRequest) (*networking.ListPeersResponse, error) {
	net := srv.net

	out := &networking.ListPeersResponse{}

	type Cursor struct {
		ID int64 `json:"i"`
	}
	var (
		count      int32
		lastCursor Cursor
	)
	type peerRow struct {
		pid       string
		isDirect  bool
		createdTS *timestamppb.Timestamp
		updatedTS *timestamppb.Timestamp
	}
	rows := []peerRow{}
	if in.PageSize <= 0 {
		in.PageSize = 100
	}
	if in.PageToken == "" {
		lastCursor.ID = math.MaxInt64
	} else {
		if err := apiutil.DecodePageToken(in.PageToken, &lastCursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qListPeers(), func(stmt *sqlite.Stmt) (err error) {
			if count == in.PageSize {
				out.NextPageToken = apiutil.EncodePageToken(lastCursor, nil)
				return nil
			}
			count++
			id := stmt.ColumnInt64(0)
			pid := stmt.ColumnText(1)
			isDirect := stmt.ColumnInt(2)
			createdTS := &timestamppb.Timestamp{Seconds: stmt.ColumnInt64(3)}
			updatedTS := &timestamppb.Timestamp{Seconds: stmt.ColumnInt64(4)}
			lastCursor.ID = id
			rows = append(rows, peerRow{
				pid:       pid,
				isDirect:  isDirect != 0,
				createdTS: createdTS,
				updatedTS: updatedTS,
			})
			return nil
		}, lastCursor.ID, in.PageSize)
	}); err != nil {
		return nil, err
	}

	out.Peers = make([]*networking.PeerInfo, 0, len(rows))

	for _, r := range rows {
		decodedPID, err := peer.Decode(r.pid)
		if err != nil {
			srv.log.Warn("Invalid peer ID in peers table", zap.String("PID", r.pid), zap.Error(err))
			continue
		}
		// Skip our own peer.
		if decodedPID == net.Libp2p().ID() {
			continue
		}

		var aidString string
		pids := r.pid
		// Addrs intentionally left nil — clients that need them call
		// GetPeerInfo(deviceId), which is sub-ms.

		var protocol string
		protos, err := net.Libp2p().Peerstore().GetProtocols(decodedPID)
		if err == nil && len(protos) > 0 {
			pinfo, ok := hmnet.FindHypermediaProtocol(protos)
			if ok {
				protocol = string(pinfo.ID)
			}
		}
		connectedness := net.Libp2p().Network().Connectedness(decodedPID)
		out.Peers = append(out.Peers, &networking.PeerInfo{
			Id:               pids,
			AccountId:        aidString,
			Addrs:            nil, // see qListPeers comment; fetch via GetPeerInfo
			Protocol:         protocol,
			ConnectionStatus: networking.ConnectionStatus(connectedness),
			IsDirect:         r.isDirect,
			CreatedAt:        r.createdTS,
			UpdatedAt:        r.updatedTS,
		})
	}

	return out, nil
}

// GetPeerInfo gets info about a peer in the IPFS peer store.
func (srv *Server) GetPeerInfo(ctx context.Context, in *networking.GetPeerInfoRequest) (*networking.PeerInfo, error) {
	if in.DeviceId == "" {
		return nil, status.Error(codes.InvalidArgument, "must specify device id")
	}

	net := srv.net

	pid, err := peer.Decode(in.DeviceId)
	if err != nil {
		return nil, fmt.Errorf("failed to parse peer ID %s: %w", in.DeviceId, err)
	}

	var addrinfo peer.AddrInfo
	if pid != net.Libp2p().Network().LocalPeer() {
		addrinfo = net.Libp2p().Peerstore().PeerInfo(pid)
		// Fallback to the peers table for gossip-only peers we've never
		// connected to. libp2p's in-memory Peerstore only carries
		// addresses for peers it has actively dialed or identified
		// against this session; a peer we know about purely via
		// peer-exchange has no entry there. Without this fallback, the
		// frontend's "Copy Addresses" action on a stored-but-never-dialed
		// peer would return nothing — the list endpoint no longer
		// supplies the addresses (see qListPeers comment).
		if len(addrinfo.Addrs) == 0 {
			if dbAddrs, err := lookupPeerAddrsFromDB(ctx, srv.db, pid.String()); err == nil && len(dbAddrs) > 0 {
				if info, err := netutil.AddrInfoFromStrings(dbAddrs...); err == nil {
					addrinfo = info
				}
			}
		}
	} else {
		addrinfo = net.AddrInfo()
		if len(addrinfo.Addrs) == 0 {
			addrinfo = net.Libp2p().Peerstore().PeerInfo(pid)
		}
	}
	mas, err := peer.AddrInfoToP2pAddrs(&addrinfo)
	if err != nil {
		return nil, fmt.Errorf("failed to get device addrs: %w", err)
	}
	addrs := []string{}
	for _, addr := range ipfs.StringAddrs(mas) {
		if !net.ArePrivateIPsAllowed() {
			ipStr := strings.Split(addr, "/")
			if len(ipStr) < 3 {
				continue
			}
			ip, err := netip.ParseAddr(ipStr[2])
			if err != nil {
				continue
			}
			if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
				continue
			}
		}

		addrs = append(addrs, addr)
	}
	connectedness := net.Libp2p().Network().Connectedness(pid)

	resp := &networking.PeerInfo{
		Id:               in.DeviceId,
		AccountId:        "", // Peers are not explicitly tied to accounts now.
		Addrs:            addrs,
		ConnectionStatus: networking.ConnectionStatus(connectedness), // ConnectionStatus is a 1-to-1 mapping for the libp2p connectedness.
	}

	return resp, nil
}

// lookupPeerAddrsFromDB returns the comma-separated multiaddrs stored for
// the given peer ID, split into individual strings. Used by GetPeerInfo as
// a fallback for peers that are in our peers table (via peer-exchange
// gossip) but not in libp2p's in-memory Peerstore. Sub-millisecond — the
// query hits the UNIQUE index on peers.pid.
func lookupPeerAddrsFromDB(ctx context.Context, db *sqlitex.Pool, pid string) ([]string, error) {
	var raw string
	if err := db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, "SELECT addresses FROM peers WHERE pid = ? LIMIT 1;", func(stmt *sqlite.Stmt) error {
			raw = stmt.ColumnText(0)
			return nil
		}, pid)
	}); err != nil {
		return nil, err
	}
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := parts[:0]
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out, nil
}
