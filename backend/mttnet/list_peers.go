package mttnet

import (
	"context"
	"math"
	p2p "seed/backend/genproto/p2p/v1alpha"
	"seed/backend/util/apiutil"
	"seed/backend/util/dqb"
	"strings"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/libp2p/go-libp2p/core/peer"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

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
func (srv *rpcMux) ListPeers(ctx context.Context, in *p2p.ListPeersRequest) (*p2p.ListPeersResponse, error) {
	net := srv.Node
	out := &p2p.ListPeersResponse{}
	// since the caller is a remote client if we don't want to share our peerlist remotely we don't do it
	if !srv.Node.cfg.PeerSharing {
		return out, nil
	}
	conn, release, err := srv.Node.db.Conn(ctx)
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
		info, err := AddrInfoFromStrings(maList...)
		if err != nil {
			srv.Node.log.Warn("Invalid address found when listing peers", zap.String("PID", pid), zap.Error(err))
			return nil
		}
		peersInfo = append(peersInfo, info)
		return nil
	}, lastCursor.ID, in.PageSize); err != nil {
		return nil, err
	}
	out.Peers = make([]*p2p.PeerInfo, 0, len(peersInfo))

	for _, peer := range peersInfo {
		// Skip our own peer.
		if peer.ID == net.Libp2p().ID() {
			continue
		}
		pids := peer.ID.String()
		addrs := AddrInfoToStrings(peer)

		connectedness := net.Libp2p().Network().Connectedness(peer.ID)

		out.Peers = append(out.Peers, &p2p.PeerInfo{
			Id:               pids,
			Addrs:            addrs,
			ConnectionStatus: p2p.ConnectionStatus(connectedness), // ConnectionStatus is a 1-to-1 mapping for the libp2p connectedness.
		})
	}

	return out, nil
}
