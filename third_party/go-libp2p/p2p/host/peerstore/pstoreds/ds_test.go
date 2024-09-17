package pstoreds

import (
	"context"
	"os"
	"testing"
	"time"

	pstore "github.com/libp2p/go-libp2p/core/peerstore"
	pt "github.com/libp2p/go-libp2p/p2p/host/peerstore/test"

	mockClock "github.com/benbjohnson/clock"
	ds "github.com/ipfs/go-datastore"
	badger "github.com/ipfs/go-ds-badger"
	leveldb "github.com/ipfs/go-ds-leveldb"
	"github.com/stretchr/testify/require"
)

type datastoreFactory func(tb testing.TB) (ds.Batching, func())

var dstores = map[string]datastoreFactory{
	// "Badger": badgerStore,
	"Leveldb": leveldbStore,
}

func TestDsPeerstore(t *testing.T) {
	for name, dsFactory := range dstores {
		t.Run(name, func(t *testing.T) {
			pt.TestPeerstore(t, peerstoreFactory(t, dsFactory, DefaultOpts()))
		})

		t.Run("protobook limits", func(t *testing.T) {
			const limit = 10
			opts := DefaultOpts()
			opts.MaxProtocols = limit
			ds, close := dsFactory(t)
			defer close()
			ps, err := NewPeerstore(context.Background(), ds, opts)
			require.NoError(t, err)
			defer ps.Close()
			pt.TestPeerstoreProtoStoreLimits(t, ps, limit)
		})
	}
}

func TestDsAddrBook(t *testing.T) {
	for name, dsFactory := range dstores {
		t.Run(name+" Cacheful", func(t *testing.T) {
			opts := DefaultOpts()
			opts.GCPurgeInterval = 1 * time.Second
			opts.CacheSize = 1024
			clk := mockClock.NewMock()
			opts.Clock = clk

			pt.TestAddrBook(t, addressBookFactory(t, dsFactory, opts), clk)
		})

		t.Run(name+" Cacheless", func(t *testing.T) {
			opts := DefaultOpts()
			opts.GCPurgeInterval = 1 * time.Second
			opts.CacheSize = 0
			clk := mockClock.NewMock()
			opts.Clock = clk

			pt.TestAddrBook(t, addressBookFactory(t, dsFactory, opts), clk)
		})
	}
}

func TestDsKeyBook(t *testing.T) {
	for name, dsFactory := range dstores {
		t.Run(name, func(t *testing.T) {
			pt.TestKeyBook(t, keyBookFactory(t, dsFactory, DefaultOpts()))
		})
	}
}

func BenchmarkDsKeyBook(b *testing.B) {
	for name, dsFactory := range dstores {
		b.Run(name, func(b *testing.B) {
			pt.BenchmarkKeyBook(b, keyBookFactory(b, dsFactory, DefaultOpts()))
		})
	}
}

func BenchmarkDsPeerstore(b *testing.B) {
	caching := DefaultOpts()
	caching.CacheSize = 1024

	cacheless := DefaultOpts()
	cacheless.CacheSize = 0

	for name, dsFactory := range dstores {
		b.Run(name, func(b *testing.B) {
			pt.BenchmarkPeerstore(b, peerstoreFactory(b, dsFactory, caching), "Caching")
		})
		b.Run(name, func(b *testing.B) {
			pt.BenchmarkPeerstore(b, peerstoreFactory(b, dsFactory, cacheless), "Cacheless")
		})
	}
}

// Doesn't work on 32bit because badger.
//
//lint:ignore U1000 disabled for now
func badgerStore(tb testing.TB) (ds.Batching, func()) {
	dataPath, err := os.MkdirTemp(os.TempDir(), "badger")
	if err != nil {
		tb.Fatal(err)
	}
	store, err := badger.NewDatastore(dataPath, nil)
	if err != nil {
		tb.Fatal(err)
	}
	closer := func() {
		store.Close()
		os.RemoveAll(dataPath)
	}
	return store, closer
}

func leveldbStore(tb testing.TB) (ds.Batching, func()) {
	// Intentionally test in-memory because disks suck, especially in CI.
	store, err := leveldb.NewDatastore("", nil)
	if err != nil {
		tb.Fatal(err)
	}
	closer := func() {
		store.Close()
	}
	return store, closer
}

func peerstoreFactory(tb testing.TB, storeFactory datastoreFactory, opts Options) pt.PeerstoreFactory {
	return func() (pstore.Peerstore, func()) {
		store, storeCloseFn := storeFactory(tb)
		ps, err := NewPeerstore(context.Background(), store, opts)
		if err != nil {
			tb.Fatal(err)
		}
		closer := func() {
			ps.Close()
			storeCloseFn()
		}
		return ps, closer
	}
}

func addressBookFactory(tb testing.TB, storeFactory datastoreFactory, opts Options) pt.AddrBookFactory {
	return func() (pstore.AddrBook, func()) {
		store, closeFunc := storeFactory(tb)
		ab, err := NewAddrBook(context.Background(), store, opts)
		if err != nil {
			tb.Fatal(err)
		}
		closer := func() {
			ab.Close()
			closeFunc()
		}
		return ab, closer
	}
}

func keyBookFactory(tb testing.TB, storeFactory datastoreFactory, opts Options) pt.KeyBookFactory {
	return func() (pstore.KeyBook, func()) {
		store, storeCloseFn := storeFactory(tb)
		kb, err := NewKeyBook(context.Background(), store, opts)
		if err != nil {
			tb.Fatal(err)
		}
		return kb, storeCloseFn
	}
}
