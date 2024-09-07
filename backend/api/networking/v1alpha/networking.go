package networking

import (
	"context"
	"fmt"
	"math"
	"net/netip"
	networking "seed/backend/genproto/networking/v1alpha"
	"seed/backend/ipfs"
	"seed/backend/mttnet"
	"seed/backend/util/apiutil"
	"seed/backend/util/dqb"
	"strings"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/libp2p/go-libp2p/core/peer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Server implements the networking API.
type Server struct {
	net *mttnet.Node
	db  *sqlitex.Pool
}

// NewServer returns a new networking API server.
func NewServer(node *mttnet.Node, db *sqlitex.Pool) *Server {
	return &Server{
		net: node,
		db:  db,
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

	info, err := mttnet.AddrInfoFromStrings(in.Addrs...)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "Can't connect due to bad addrs: %v", err)
	}

	net := srv.net

	if err := net.ForceConnect(ctx, info); err != nil {
		return nil, err
	}

	return &networking.ConnectResponse{}, nil
}

var qListPeers = dqb.Str(`
	SELECT 
		id,
		addresses,
		pid
	FROM peers
	WHERE id < :last_cursor
	ORDER BY id DESC LIMIT :page_size + 1;
`)

// ListPeers filters peers by status. If no status provided, it lists all peers.
func (srv *Server) ListPeers(ctx context.Context, in *networking.ListPeersRequest) (*networking.ListPeersResponse, error) {
	net := srv.net

	out := &networking.ListPeersResponse{}

	conn, release, err := srv.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	type Cursor struct {
		ID   int64  `json:"i"`
		Addr string `json:"a"`
	}
	var (
		count      int32
		lastCursor Cursor
	)
	peersInfo := []peer.AddrInfo{}
	if in.PageSize <= 0 {
		in.PageSize = 30
	}
	if in.PageToken == "" {
		lastCursor.ID = math.MaxInt64
		lastCursor.Addr = string([]rune{0xFFFF}) // Max string.
	} else {
		if err := apiutil.DecodePageToken(in.PageToken, &lastCursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}
	if err = sqlitex.Exec(conn, qListPeers(), func(stmt *sqlite.Stmt) error {
		if count == in.PageSize {
			var err error
			out.NextPageToken, err = apiutil.EncodePageToken(lastCursor, nil)
			return err
		}
		count++
		id := stmt.ColumnInt64(0)
		maStr := stmt.ColumnText(1)
		pid := stmt.ColumnText(2)
		lastCursor.ID = id
		lastCursor.Addr = maStr
		maList := strings.Split(strings.Trim(maStr, " "), ",")
		info, err := mttnet.AddrInfoFromStrings(maList...)
		if err != nil {
			return fmt.Errorf("ListPeers failed due to some peer [%s] having invalid addresses: %w", pid, err)
		}
		peersInfo = append(peersInfo, info)
		return nil
	}, lastCursor.ID, in.PageSize); err != nil {
		return nil, err
	}

	out.Peers = make([]*networking.PeerInfo, 0, len(peersInfo))

	for _, peer := range peersInfo {
		// Skip our own peer.
		if peer.ID == net.Libp2p().ID() {
			continue
		}

		var aidString string
		pids := peer.ID.String()
		addrs := mttnet.AddrInfoToStrings(peer)
		aid, err := net.AccountForDevice(ctx, peer.ID)
		if err == nil {
			aidString = aid.String()
		}

		connectedness := net.Libp2p().Network().Connectedness(peer.ID)

		out.Peers = append(out.Peers, &networking.PeerInfo{
			Id:               pids,
			AccountId:        aidString,
			Addrs:            addrs,
			ConnectionStatus: networking.ConnectionStatus(connectedness), // ConnectionStatus is a 1-to-1 mapping for the libp2p connectedness.
		})
	}

	return out, nil
}

// GetPeerInfo gets info about
func (srv *Server) GetPeerInfo(ctx context.Context, in *networking.GetPeerInfoRequest) (*networking.PeerInfo, error) {
	if in.DeviceId == "" {
		return nil, status.Error(codes.InvalidArgument, "must specify device id")
	}

	net := srv.net

	pid, err := peer.Decode(in.DeviceId)
	if err != nil {
		return nil, fmt.Errorf("failed to parse peer ID %s: %w", in.DeviceId, err)
	}

	addrinfo := net.Libp2p().Peerstore().PeerInfo(pid)
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
	var aidString string
	aid, err := net.AccountForDevice(ctx, pid)
	if err == nil {
		aidString = aid.String()
	}

	resp := &networking.PeerInfo{
		Id:               in.DeviceId,
		AccountId:        aidString,
		Addrs:            addrs,
		ConnectionStatus: networking.ConnectionStatus(connectedness), // ConnectionStatus is a 1-to-1 mapping for the libp2p connectedness.
	}

	return resp, nil
}
