package mttnet

import (
	"context"
	"math/rand"
	"seed/backend/logging"
	"seed/backend/util/dqb"
	"time"

	"crawshaw.io/sqlite"
	"crawshaw.io/sqlite/sqlitex"
	"github.com/ipfs/boxo/provider"
	"github.com/ipfs/go-cid"
	"go.uber.org/zap"
)

var randSrc = rand.NewSource(time.Now().UnixNano())
var qListCids = dqb.Str(`
	SELECT
		blobs.codec,
		blobs.multihash
	FROM blobs INDEXED BY blobs_metadata
	WHERE blobs.size > 0;
`)

func makeProvidingStrategy(db *sqlitex.Pool, logLevel string) provider.KeyChanFunc {
	// This providing strategy returns all the CID known to the blockstore
	// except those which are marked as draft changes.
	// TODO(burdiyan): this is a temporary solution during the braking change.

	log := logging.New("seed/reprovider", logLevel)

	return func(ctx context.Context) (<-chan cid.Cid, error) {
		ch := make(chan cid.Cid, 30) // arbitrary buffer

		go func() {
			defer close(ch)

			conn, release, err := db.Conn(ctx)
			if err != nil {
				log.Error("Failed to open db connection: %w", zap.Error(err))
				return
			}

			// We want to provide all the entity IDs, so we convert them into raw CIDs,
			// similar to how libp2p discovery service is doing.
			cids := []cid.Cid{}
			if err = sqlitex.Exec(conn, qListCids(), func(stmt *sqlite.Stmt) error {
				codec := stmt.ColumnInt64(0)
				hash := stmt.ColumnBytesUnsafe(1)
				c := cid.NewCidV1(uint64(codec), hash)
				cids = append(cids, c)
				return nil
			}); err != nil {
				release()
				log.Error("Could not list CIDs: ", zap.Error(err))
				return
			}
			release()
			log.Info("Start reproviding", zap.Int("Number of CIDs", len(cids)))
			// Since reproviding takes long AND is has throttle limits, we are better off randomizing it.
			r := rand.New(randSrc) //nolint:gosec
			r.Shuffle(len(cids), func(i, j int) { cids[i], cids[j] = cids[j], cids[i] })
			for _, c := range cids {
				select {
				case <-ctx.Done():
					log.Info("Reproviding context cancelled")
					return
				case ch <- c:
					// Send
					log.Debug("Reproviding", zap.String("CID", c.String()))
				}
			}
			log.Info("Finish reproviding", zap.Int("Number of cids", len(cids)))
		}()
		return ch, nil
	}
}
