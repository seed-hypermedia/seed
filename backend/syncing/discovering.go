package syncing

import (
	"context"
	"fmt"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/ipfs"
	"seed/backend/mttnet"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"strings"
	"time"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/multiformats/go-multicodec"
	"go.uber.org/zap"
)

// DefaultDiscoveryTimeout is how long do we wait to discover a peer and sync with it
const (
	DefaultDiscoveryTimeout = time.Second * 30
	DefaultSyncingTimeout   = 1 * DefaultDiscoveryTimeout / 3
	DefaultDHTTimeout       = 2 * DefaultDiscoveryTimeout / 3
)

// DiscoverObject discovers an object in the network. If not found, then it returns an error
// If found, this function will store the object locally so that it can be gotten like any
// other local object. This function blocks until either success or fails to find providers.
func (s *Service) DiscoverObject(ctx context.Context, entityID, version string, recursive bool) (string, error) {
	if s.cfg.NoDiscovery {
		return "", fmt.Errorf("remote content discovery is disabled")
	}

	if s.docGetter == nil {
		return "", fmt.Errorf("Document getter not set")
	}
	ctxLocalPeers, cancel := context.WithTimeout(ctx, DefaultSyncingTimeout)
	defer cancel()
	c, err := ipfs.NewCID(uint64(multicodec.Raw), uint64(multicodec.Identity), []byte(entityID))
	if err != nil {
		return "", fmt.Errorf("Couldn't encode eid into CID: %w", err)
	}

	iri := strings.TrimPrefix(entityID, "hm://")
	acc := strings.Split(iri, "/")[0]
	path := strings.TrimPrefix(iri, acc)
	if version != "" {
		doc, err := s.docGetter.GetDocument(ctxLocalPeers, &documents.GetDocumentRequest{
			Account: acc,
			Path:    path,
			Version: version,
		})
		if err == nil && doc.Version == version {
			s.log.Debug("It's your lucky day, the document was already in the db!. we avoided syncing with peers.")
			return doc.Version, nil
		}
	}

	conn, release, err := s.db.Conn(ctxLocalPeers)
	if err != nil {
		s.log.Debug("Could not grab a connection", zap.Error(err))
		return "", err
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
		if s.host.Network().Connectedness(info.ID) == network.Connected {
			allPeers = append(allPeers, info.ID)
		}

		return nil
	}); err != nil {
		release()
		return "", err
	}
	release()
	if len(allPeers) != 0 {
		s.log.Debug("Discovering via connected local peers first", zap.Error(err))
		eidsMap := make(map[string]bool)
		eidsMap[entityID] = recursive
		for _, pid := range allPeers {
			// TODO(juligasa): look into the providers store who has each eid
			// instead of pasting all peers in all documents.
			subsMap[pid] = eidsMap
		}

		res := s.SyncWithManyPeers(ctxLocalPeers, subsMap)
		if res.NumSyncOK > 0 {
			doc, err := s.docGetter.GetDocument(ctxLocalPeers, &documents.GetDocumentRequest{
				Account: acc,
				Path:    path,
			})
			if err == nil && (version == "" || doc.Version == version) {
				s.log.Debug("Discovered content via local peer, we avoided hitting the DHT!")
				return doc.Version, nil
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
	ctxDHT, cancelDHTCtx := context.WithTimeout(ctx, DefaultDHTTimeout)
	defer cancelDHTCtx()
	peers := s.bitswap.FindProvidersAsync(ctxDHT, c, maxProviders)
	if len(peers) == 0 {
		return "", fmt.Errorf("After checking local peers, no dht providers were found serving CID %s", c.String())
	}

	eidsMap := make(map[string]bool)
	eidsMap[entityID] = recursive
	subsMap = make(subscriptionMap)
	for p := range peers {
		p := p
		// TODO(juligasa): look into the providers store who has each eid
		// instead of pasting all peers in all documents.
		subsMap[p.ID] = eidsMap
	}

	res := s.SyncWithManyPeers(ctxDHT, subsMap)
	if res.NumSyncOK > 0 {
		doc, err := s.docGetter.GetDocument(ctxDHT, &documents.GetDocumentRequest{
			Account: acc,
			Path:    path,
			Version: version,
		})
		if err == nil && (version == "" || doc.Version == version) {
			s.log.Debug("Discovered content via DHT")
			return doc.Version, nil
		}
	}
	return "", fmt.Errorf("Found some DHT providers but could not get document from them %s", c.String())
}

var qGetEntity = dqb.Str(`
		SELECT
			iri
		FROM resources 
		WHERE iri = :iri
		LIMIT 1;
	`)
