package syncing

import (
	"context"
	"fmt"
	"seed/backend/ipfs"
	"seed/backend/mttnet"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"strings"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/libp2p/go-libp2p/core/peerstore"
	"github.com/multiformats/go-multicodec"
	"go.uber.org/zap"
)

// DefaultDiscoveryTimeout is how long do we wait to discover a peer and sync with it
const DefaultDiscoveryTimeout = time.Second * 30

// DiscoverObject discovers an object in the network. If not found, then it returns an error
// If found, this function will store the object locally so that it can be gotten like any
// other local object. This function blocks until either success or fails to find providers.
func (s *Service) DiscoverObject(ctx context.Context, entityID, version string) error {
	if s.cfg.NoDiscovery {
		return fmt.Errorf("remote content discovery is disabled")
	}
	if version != "" {
		return fmt.Errorf("Discovering by version is not implemented yet")
	}

	ctx, cancel := context.WithTimeout(ctx, DefaultDiscoveryTimeout)
	defer cancel()
	c, err := ipfs.NewCID(uint64(multicodec.Raw), uint64(multicodec.Identity), []byte(entityID))
	if err != nil {
		return fmt.Errorf("Couldn't encode eid into CID: %w", err)
	}

	conn, release, err := s.db.Conn(ctx)
	if err != nil {
		s.log.Debug("Could not grab a connection", zap.Error(err))
		return err
	}

	subsMap := make(subscriptionMap)
	allPeers := []peer.ID{} // TODO:(juligasa): Remove this when we have providers store
	if err = sqlitex.Exec(conn, qListPeersWithPid(), func(stmt *sqlite.Stmt) error {
		addresStr := stmt.ColumnText(0)
		pid := stmt.ColumnText(1)
		addrList := strings.Split(addresStr, ",")
		info, err := mttnet.AddrInfoFromStrings(addrList...)
		if err != nil {
			s.log.Warn("Can't discover from peer since it has malformed addresses", zap.String("PID", pid), zap.Error(err))
			return nil
		}
		s.host.Peerstore().AddAddrs(info.ID, info.Addrs, peerstore.TempAddrTTL)
		allPeers = append(allPeers, info.ID)
		return nil
	}); err != nil {
		release()
		return err
	}
	if len(allPeers) != 0 {
		s.log.Debug("Discovering via local peers first", zap.Error(err))
		eidsMap := make(map[string]bool)
		eidsMap[entityID] = false
		for _, pid := range allPeers {
			// TODO(juligasa): look into the providers store who has each eid
			// instead of pasting all peers in all documents.
			subsMap[pid] = eidsMap
		}

		ret := s.SyncWithManyPeers(ctx, subsMap)
		if ret.NumSyncOK > 0 {
			var haveIt bool
			if err = sqlitex.Exec(conn, qGetEntity(), func(stmt *sqlite.Stmt) error {
				eid := stmt.ColumnText(0)
				if eid != entityID {
					return fmt.Errorf("Got a different eid")
				}
				haveIt = true
				return nil
			}, entityID); err != nil {
				s.log.Warn("Problem finding eid after local discovery", zap.Error(err))
			} else if haveIt {
				s.log.Debug("Discovered content via local peer, we avoided hitting the DHT!")
				return nil
			}
		}
	}
	s.log.Debug("None of the local peers have the document, hitting the DHT :(")
	// Arbitrary number of maximum providers
	maxProviders := 15

	// If we are looking for a specific version, we don't need to limit the number of providers,
	// because we will short-circuit as soon as we found the desired version.
	if version != "" {
		maxProviders = 0
	}

	peers := s.bitswap.FindProvidersAsync(ctx, c, maxProviders)

	for p := range peers {
		p := p
		s.host.Peerstore().AddAddrs(p.ID, p.Addrs, peerstore.TempAddrTTL)
		log := s.log.With(
			zap.String("entity", entityID),
			zap.String("CID", c.String()),
			zap.String("peer", p.String()),
		)
		log.Debug("Provider Found")
		eidMap := map[string]bool{entityID: false}
		if err := s.SyncWithPeer(ctx, p.ID, eidMap); err != nil {
			log.Debug("Error trying to sync with a provider", zap.Error(err))
			continue
		}
		return nil
	}

	return fmt.Errorf("No providers found for CID %s", c.String())
}

var qGetEntity = dqb.Str(`
		SELECT
			iri
		FROM resources 
		WHERE iri = :iri
		LIMIT 1;
	`)
