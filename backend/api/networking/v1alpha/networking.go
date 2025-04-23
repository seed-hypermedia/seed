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

var qListPeers = dqb.Str(`
	SELECT
		id,
		addresses,
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
		ID   int64  `json:"i"`
		Addr string `json:"a"`
	}
	var (
		count      int32
		lastCursor Cursor
	)
	peersInfo := []peer.AddrInfo{}
	extraData := []peerExtra{}
	if in.PageSize <= 0 {
		in.PageSize = 100
	}
	if in.PageToken == "" {
		lastCursor.ID = math.MaxInt64
		lastCursor.Addr = string([]rune{0xFFFF}) // Max string.
	} else {
		if err := apiutil.DecodePageToken(in.PageToken, &lastCursor, nil); err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
	}
	if err := srv.db.WithSave(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.Exec(conn, qListPeers(), func(stmt *sqlite.Stmt) error {
			if count == in.PageSize {
				var err error
				out.NextPageToken, err = apiutil.EncodePageToken(lastCursor, nil)
				return err
			}
			count++
			id := stmt.ColumnInt64(0)
			maStr := stmt.ColumnText(1)
			pid := stmt.ColumnText(2)
			isDirect := stmt.ColumnInt(3)
			createdTS := &timestamppb.Timestamp{Seconds: stmt.ColumnInt64(4)}
			updatedTS := &timestamppb.Timestamp{Seconds: stmt.ColumnInt64(5)}
			lastCursor.ID = id
			lastCursor.Addr = maStr
			maList := strings.Split(strings.Trim(maStr, " "), ",")
			info, err := netutil.AddrInfoFromStrings(maList...)
			if err != nil {
				srv.log.Warn("Invalid address found when listing peers", zap.String("PID", pid), zap.Error(err))
				return nil
			}
			peersInfo = append(peersInfo, info)
			extraData = append(extraData, peerExtra{
				createdTS: createdTS,
				updatedTS: updatedTS,
				isDirect:  isDirect != 0,
			})
			return nil
		}, lastCursor.ID, in.PageSize)
	}); err != nil {
		return nil, err
	}

	out.Peers = make([]*networking.PeerInfo, 0, len(peersInfo))

	for i, peer := range peersInfo {
		// Skip our own peer.
		if peer.ID == net.Libp2p().ID() {
			continue
		}

		var aidString string
		pids := peer.ID.String()
		addrs := hmnet.AddrInfoToStrings(peer)

		var protocol string
		protos, err := net.Libp2p().Peerstore().GetProtocols(peer.ID)
		if err == nil && len(protos) > 0 {
			pinfo, ok := hmnet.FindHypermediaProtocol(protos)
			if ok {
				protocol = string(pinfo.ID)
			}
		}
		connectedness := net.Libp2p().Network().Connectedness(peer.ID)
		out.Peers = append(out.Peers, &networking.PeerInfo{
			Id:               pids,
			AccountId:        aidString,
			Addrs:            addrs,
			Protocol:         protocol,
			ConnectionStatus: networking.ConnectionStatus(connectedness),
			IsDirect:         extraData[i].isDirect,
			CreatedAt:        extraData[i].createdTS,
			UpdatedAt:        extraData[i].updatedTS,
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
