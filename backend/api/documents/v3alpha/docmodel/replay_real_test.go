package docmodel

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math/rand"
	"os"
	"runtime/debug"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"seed/backend/blob"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/sqlite"

	"github.com/RoaringBitmap/roaring/v2/roaring64"
	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/klauspost/compress/zstd"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestReplayRealDocuments replays the documents of a real daemon database through the code
// that prepares document changes, and writes one JSON line per (document, step) with what got stored.
//
// It's a validation tool for changes to how moves and attribute writes are committed, not a unit test:
// it's skipped unless SEED_REPLAY_DB points to a private copy of a daemon database
// (never a database in use: make one with `sqlite3 db.sqlite ".backup copy.sqlite"`, or with VACUUM INTO
// followed by `PRAGMA journal_mode=wal` on the copy, when the backup keeps restarting because the source is written to).
// Nothing is written to the copy, but it's opened the way the daemon opens it, which is not read-only.
//
// For every document it loads the latest state, and runs a number of requests, each on a fresh load:
// the whole document sent again as is (nothing must be stored), single edits, and the whole document sent again
// with one or many differences. For each request it checks that the stored moves and deletes are the fewest
// that do it, that a replica loaded from the stored bytes reads the expected tree with the same content
// and metadata, and that the change is small. See replaySteps.
//
//	SEED_REPLAY_DB       path to the database copy.
//	SEED_REPLAY_OUT      JSONL file to append results to. Steps already there are skipped, so runs can be resumed.
//	SEED_REPLAY_LABEL    free-form label stored in every record (e.g. the code version).
//	SEED_REPLAY_SHARD    "i/n" to only process every n-th document.
//	SEED_REPLAY_TIMEOUT  per-step timeout (default 60s). When a step exceeds it, a record is written
//	                     and the process exits with code 3: run it again to continue with the next step.
//	SEED_REPLAY_MAX_HANGS stop trying the steps of a document after this many of them timed out (default 2).
//	SEED_REPLAY_LIMIT    only process the N documents having the most changes.
//	SEED_REPLAY_ONLY     only process the document with this IRI.
//	SEED_REPLAY_STEPS    comma-separated names of the steps to run (default all).
//	SEED_REPLAY_PREFIXES replay earlier states of every document instead of the latest one: up to this many
//	                     prefixes of its changes, in the order they are applied. These states often have
//	                     several heads. Records get "#prefix=N" appended to the IRI.
//
// The file only uses what exists before and after the change being validated,
// so it can be copied as is into a checkout of another version to compare.
func TestReplayRealDocuments(t *testing.T) {
	dbPath := os.Getenv("SEED_REPLAY_DB")
	if dbPath == "" {
		t.Skip("SEED_REPLAY_DB is not set")
	}

	outPath := os.Getenv("SEED_REPLAY_OUT")
	if outPath == "" {
		t.Fatal("SEED_REPLAY_OUT is not set")
	}

	r := &replayer{
		label:   os.Getenv("SEED_REPLAY_LABEL"),
		timeout: time.Minute,
		done:    map[string]struct{}{},
		hangs:   map[string]int{},
		maxHang: 2,
	}

	if v := os.Getenv("SEED_REPLAY_MAX_HANGS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			t.Fatal(err)
		}
		r.maxHang = n
	}

	if v := os.Getenv("SEED_REPLAY_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			t.Fatal(err)
		}
		r.timeout = d
	}

	if data, err := os.ReadFile(outPath); err == nil { //nolint:gosec
		for _, line := range strings.Split(string(data), "\n") {
			var rec replayRecord
			if json.Unmarshal([]byte(line), &rec) == nil && rec.IRI != "" {
				r.done[rec.IRI+"|"+rec.Step] = struct{}{}
				if rec.Hang {
					r.hangs[rec.IRI]++
				}
			}
		}
	}

	out, err := os.OpenFile(outPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600) //nolint:gosec
	if err != nil {
		t.Fatal(err)
	}
	defer out.Close()
	r.out = out

	conn, err := sqlite.OpenConn(dbPath, sqlite.SQLITE_OPEN_READWRITE|sqlite.SQLITE_OPEN_WAL|sqlite.SQLITE_OPEN_URI|sqlite.SQLITE_OPEN_NOMUTEX)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	r.conn = conn

	dec, err := zstd.NewReader(nil)
	if err != nil {
		t.Fatal(err)
	}
	r.dec = dec

	docs := r.listDocuments(t)

	if v := os.Getenv("SEED_REPLAY_LIMIT"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			t.Fatal(err)
		}
		docs = docs[:min(n, len(docs))]
	}

	shard, shards := 0, 1
	if v := os.Getenv("SEED_REPLAY_SHARD"); v != "" {
		if _, err := fmt.Sscanf(v, "%d/%d", &shard, &shards); err != nil {
			t.Fatal(err)
		}
	}

	only := os.Getenv("SEED_REPLAY_ONLY")

	if v := os.Getenv("SEED_REPLAY_STEPS"); v != "" {
		r.steps = strings.Split(v, ",")
	}

	var prefixes int
	if v := os.Getenv("SEED_REPLAY_PREFIXES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			t.Fatal(err)
		}
		prefixes = n
	}

	go r.watchdog()

	for i, d := range docs {
		if i%shards != shard {
			continue
		}

		if only != "" && d.IRI != only {
			continue
		}

		if prefixes == 0 {
			r.replayDocument(d)
			continue
		}

		// Earlier states of the document, evenly spread over its history.
		n := d.NChanges - 1
		last := 0
		for j := 1; j <= min(prefixes, n); j++ {
			k := j * n / min(prefixes, n)
			if k == last {
				continue
			}
			last = k

			pd := d
			pd.Prefix = k
			r.replayDocument(pd)
		}
	}
}

type replayDoc struct {
	IRI string
	// When set, only this many of the first changes are applied.
	Prefix    int
	ChangeIDs string // JSON array of blob IDs.
	NChanges  int
}

// Key identifies the replayed state in the records.
func (d replayDoc) Key() string {
	if d.Prefix > 0 {
		return d.IRI + "#prefix=" + strconv.Itoa(d.Prefix)
	}

	return d.IRI
}

type replayRecord struct {
	Label string `json:"label,omitempty"`
	IRI   string `json:"iri"`
	Step  string `json:"step"`

	// Shape of the document.
	Changes   int `json:"changes"`
	Heads     int `json:"heads,omitempty"`
	Blocks    int `json:"blocks,omitempty"`
	MaxLevel  int `json:"maxLevel,omitempty"`
	Depth     int `json:"depth,omitempty"`
	Trashed   int `json:"trashed,omitempty"`
	Invisible int `json:"invisible,omitempty"`
	MoveLog   int `json:"moveLog,omitempty"`
	Detached  int `json:"detached,omitempty"`
	MetaKeys  int `json:"metaKeys,omitempty"`
	// Metadata leaves that can't be sent through the API (lists, fractions, keys with dots).
	MetaSkipped int `json:"metaSkipped,omitempty"`
	// Metadata keys holding a whole map or list as their value, which the API can't write.
	// Nothing below them is sent: writing a leaf there replaces the whole value.
	MetaCompound int `json:"metaCompound,omitempty"`
	// Blocks that have a position but no content. They are read as empty blocks,
	// and are not written back: that would give them a content they don't have.
	NoContent int `json:"noContent,omitempty"`

	// Outcome.
	Skipped string `json:"skipped,omitempty"` // Why the step doesn't apply to this document.
	Hang    bool   `json:"hang,omitempty"`
	Err     string `json:"err,omitempty"`   // Error of the load, of the request, or of creating the change.
	Panic   string `json:"panic,omitempty"` // Same, for panics.
	OK      bool   `json:"ok"`
	Fail    string `json:"fail,omitempty"` // Which assertions failed.

	// What got stored.
	Moves    int `json:"moves"`
	MoveOps  int `json:"moveOps"`
	Deletes  int `json:"deletes"`
	Replaces int `json:"replaces"`
	Attrs    int `json:"attrs"`
	Bytes    int `json:"bytes"`

	WantMoves   int `json:"wantMoves"`
	WantDeletes int `json:"wantDeletes"`

	// Blocks with unexpected stored moves, deletes, or content (IDs only), and unexpected attribute keys.
	Detail []string `json:"detail,omitempty"`

	LoadNs    int64 `json:"loadNs,omitempty"`
	RequestNs int64 `json:"requestNs,omitempty"` // Applying the request to the document.
	CommitNs  int64 `json:"commitNs,omitempty"`  // Creating the change.
}

type replayer struct {
	label   string
	timeout time.Duration
	conn    *sqlite.Conn
	dec     *zstd.Decoder
	done    map[string]struct{}
	hangs   map[string]int
	maxHang int
	steps   []string

	mu      sync.Mutex
	out     *os.File
	current replayRecord
	started time.Time
}

func (r *replayer) write(rec replayRecord) {
	rec.Label = r.label
	data, err := json.Marshal(rec)
	if err != nil {
		panic(err)
	}

	if _, err := r.out.Write(append(data, '\n')); err != nil {
		panic(err)
	}
}

func (r *replayer) watchdog() {
	for {
		time.Sleep(200 * time.Millisecond)

		r.mu.Lock()
		if !r.started.IsZero() && time.Since(r.started) > r.timeout {
			rec := r.current
			rec.Hang = true
			r.write(rec)
			_ = r.out.Sync()
			os.Exit(3)
		}
		r.mu.Unlock()
	}
}

func (r *replayer) listDocuments(t *testing.T) []replayDoc {
	// Same choice as the index makes: the latest generation of each resource.
	stmt := r.conn.Prep(`
		SELECT r.iri, dg.changes, dg.change_count, dg.is_deleted, dg.heads
		FROM document_generations dg
		JOIN resources r ON r.id = dg.resource
		ORDER BY dg.resource, dg.generation DESC`)
	defer func() { _ = stmt.Reset() }()

	var (
		docs []replayDoc
		last string
	)

	for {
		ok, err := stmt.Step()
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			break
		}

		iri := stmt.ColumnText(0)
		if iri == last {
			continue
		}
		last = iri

		if stmt.ColumnInt(3) != 0 || stmt.ColumnInt(2) == 0 {
			continue
		}

		ids, err := replayBitmapIDs(stmt.ColumnBytes(1))
		if err != nil {
			t.Fatal(err)
		}

		if len(ids) == 0 {
			continue
		}

		data, err := json.Marshal(ids)
		if err != nil {
			t.Fatal(err)
		}

		docs = append(docs, replayDoc{IRI: iri, ChangeIDs: string(data), NChanges: len(ids)})
	}

	sort.SliceStable(docs, func(i, j int) bool { return docs[i].NChanges > docs[j].NChanges })

	return docs
}

type replayChange struct {
	CID  cid.Cid
	Data []byte
}

// loadChanges reads the changes of the document the way the index does (see blob.Index.IterChanges).
func (r *replayer) loadChanges(d replayDoc) ([]replayChange, error) {
	stmt := r.conn.Prep(`
		WITH RECURSIVE
		changes (id) AS (
			SELECT value FROM json_each(:heads)
			UNION
			SELECT target
			FROM blob_links
			JOIN changes ON changes.id = blob_links.source
				AND blob_links.type = 'change/dep'
		)
		SELECT
			codec,
			multihash,
			data
		FROM changes
		JOIN blobs ON changes.id = blobs.id
		LEFT JOIN structural_blobs ON structural_blobs.id = blobs.id
		ORDER BY structural_blobs.ts;`)
	defer func() { _ = stmt.Reset() }()

	stmt.SetText(":heads", d.ChangeIDs)

	var out []replayChange

	for {
		ok, err := stmt.Step()
		if err != nil {
			return nil, err
		}
		if !ok {
			break
		}

		c := cid.NewCidV1(uint64(stmt.ColumnInt64(0)), stmt.ColumnBytes(1)) //nolint:gosec

		compressed := stmt.ColumnBytesUnsafe(2)
		if len(compressed) == 0 {
			return nil, fmt.Errorf("empty data for change %s", c)
		}

		data, err := r.dec.DecodeAll(compressed, nil)
		if err != nil {
			return nil, err
		}

		out = append(out, replayChange{CID: c, Data: data})
	}

	return out, nil
}

func replayLoad(iri string, changes []replayChange) (*Document, error) {
	doc, err := New(blob.IRI(iri), cclock.New())
	if err != nil {
		return nil, err
	}

	for _, c := range changes {
		ch := &blob.Change{}
		if err := cbornode.DecodeInto(c.Data, ch); err != nil {
			return nil, fmt.Errorf("failed to decode change %s: %w", c.CID, err)
		}

		if err := doc.ApplyChange(c.CID, ch); err != nil {
			return nil, fmt.Errorf("failed to apply change %s: %w", c.CID, err)
		}
	}

	return doc, nil
}

// replayModel is the visible tree of a document, with the content of its blocks.
type replayModel struct {
	Levels map[string][]string
	Blocks map[string]*documents.Block
	Meta   []replayAttr
	// Metadata as it's read, to compare all of it.
	Metadata *structpb.Struct
	// Metadata leaves that can't be sent through the API.
	MetaSkipped  int
	MetaCompound int
	// Blocks that have a position but no content.
	NoContent map[string]struct{}
	// Deleted blocks having no visible children, sorted.
	Trashed []string
	// Seed for the steps that need randomness, derived from the document ID.
	Seed int64

	// Top-level metadata keys holding maps that the API can write entirely.
	Maps []string

	// Set by the steps whose expected result depends on the document.
	ExtraMoves   int
	ExtraDeletes int
	WantAttrs    int
	// Metadata that must be read back, when the step changes it.
	WantMetadata map[string]any
	// Blocks whose content is not compared: it's not part of what was read initially.
	Ignore map[string]struct{}
	Depth  int
	// Deepest block, and the block having the most children.
	Deepest string
	Largest string
}

type replayAttr struct {
	Key   []string
	Value any
}

func newReplayModel(docpb *documents.Document, doc *Document) *replayModel {
	m := &replayModel{
		Levels:   map[string][]string{},
		Blocks:   map[string]*documents.Block{},
		Metadata: docpb.Metadata,

		NoContent: map[string]struct{}{},
	}

	// Keys whose stored value is a whole map or list.
	var compound [][]string
	for k, reg := range doc.crdt.stateMetadata.Items() {
		if latest, ok := reg.GetLatestOK(); ok {
			switch latest.Value.(type) {
			case map[string]any, []any:
				compound = append(compound, slices.Clone(k))
			}
		}
	}

	var walk func(parent string, nodes []*documents.BlockNode, depth int)
	walk = func(parent string, nodes []*documents.BlockNode, depth int) {
		for _, n := range nodes {
			m.Levels[parent] = append(m.Levels[parent], n.Block.Id)
			m.Blocks[n.Block.Id] = n.Block

			if reg := doc.crdt.stateBlocks[n.Block.Id]; reg == nil {
				m.NoContent[n.Block.Id] = struct{}{}
			} else if _, ok := reg.GetLatestOK(); !ok {
				m.NoContent[n.Block.Id] = struct{}{}
			}

			if depth > m.Depth {
				m.Depth = depth
				m.Deepest = n.Block.Id
			}

			walk(n.Block.Id, n.Children, depth+1)
		}
	}
	walk("", docpb.Content, 1)

	for parent, children := range m.Levels {
		if parent == "" {
			continue
		}

		if n := len(m.Levels[m.Largest]); m.Largest == "" || len(children) > n || (len(children) == n && parent < m.Largest) {
			m.Largest = parent
		}
	}

	// Top-level keys having something below that can't be sent.
	unsendable := map[string]struct{}{}
	skip := func(prefix []string) {
		if len(prefix) > 0 {
			unsendable[prefix[0]] = struct{}{}
		}
	}

	var flatten func(prefix []string, v any)
	flatten = func(prefix []string, v any) {
		if slices.ContainsFunc(compound, func(k []string) bool { return slices.Equal(k, prefix) }) {
			m.MetaCompound++
			skip(prefix)
			return
		}

		switch v := v.(type) {
		case map[string]any:
			keys := make([]string, 0, len(v))
			for k := range v {
				keys = append(keys, k)
			}
			slices.Sort(keys)

			for _, k := range keys {
				if strings.Contains(k, ".") {
					m.MetaSkipped++
					skip(append(slices.Clone(prefix), k))
					continue
				}

				if len(v) == 0 {
					skip(prefix)
				}

				flatten(append(slices.Clone(prefix), k), v[k])
			}
		case float64:
			// The API only has whole numbers.
			if n := int64(v); float64(n) == v {
				m.Meta = append(m.Meta, replayAttr{Key: prefix, Value: n})
			} else {
				m.MetaSkipped++
				skip(prefix)
			}
		case string, bool, nil:
			m.Meta = append(m.Meta, replayAttr{Key: prefix, Value: v})
		default:
			m.MetaSkipped++
			skip(prefix)
		}
	}
	flatten(nil, docpb.Metadata.AsMap())

	for _, kv := range m.Meta {
		if _, bad := unsendable[kv.Key[0]]; !bad && len(kv.Key) > 1 && !slices.Contains(m.Maps, kv.Key[0]) {
			m.Maps = append(m.Maps, kv.Key[0])
		}
	}

	state := doc.crdt.tree.State()
	for blk, bs := range state.blocks {
		if bs.Parent != TrashNodeID {
			continue
		}

		hasChildren := false
		for range state.DFT(blk) {
			hasChildren = true
			break
		}

		if !hasChildren {
			m.Trashed = append(m.Trashed, blk)
		}
	}
	slices.Sort(m.Trashed)

	h := fnv.New64a()
	_, _ = h.Write([]byte(doc.crdt.id))
	m.Seed = int64(h.Sum64() >> 1) //nolint:gosec

	return m
}

func (m *replayModel) Copy() *replayModel {
	cpy := *m
	cpy.Levels = make(map[string][]string, len(m.Levels))
	for k, v := range m.Levels {
		cpy.Levels[k] = slices.Clone(v)
	}

	return &cpy
}

// Pairs returns the (parent, child) pairs of the tree in depth-first order.
func (m *replayModel) Pairs() []blockPair {
	var out []blockPair

	var walk func(parent string)
	walk = func(parent string) {
		for _, c := range m.Levels[parent] {
			out = append(out, blockPair{Parent: parent, Child: c})
			walk(c)
		}
	}
	walk("")

	return out
}

func (m *replayModel) remove(block string) {
	for parent, children := range m.Levels {
		if i := slices.Index(children, block); i >= 0 {
			m.Levels[parent] = slices.Delete(children, i, i+1)
			return
		}
	}
}

func (m *replayModel) insert(block, parent, left string) {
	children := m.Levels[parent]

	i := 0
	if left != "" {
		i = slices.Index(children, left) + 1
	}

	m.Levels[parent] = slices.Insert(children, i, block)
}

// relist sends the whole document again: every level in its current order,
// every block, and every metadata leaf. It's what a client that doesn't diff does.
func (m *replayModel) relist(doc *Document) error {
	var walk func(parent string) error
	walk = func(parent string) error {
		var left string

		for _, c := range m.Levels[parent] {
			if err := doc.MoveBlock(c, parent, left); err != nil {
				return err
			}
			left = c

			if _, noContent := m.NoContent[c]; !noContent && m.Blocks[c] != nil {
				if err := doc.ReplaceBlock(m.Blocks[c]); err != nil {
					return err
				}
			}

			if err := walk(c); err != nil {
				return err
			}
		}

		return nil
	}

	if err := walk(""); err != nil {
		return err
	}

	for _, kv := range m.Meta {
		if err := doc.SetAttribute("", kv.Key, kv.Value); err != nil {
			return err
		}
	}

	return nil
}

const replayNewBlock = "replayNew"

type replayStep struct {
	Name string
	// Run applies the request to the document and the expected result to the model.
	// It returns why the step doesn't apply to the document, if it doesn't.
	Run         func(doc *Document, m *replayModel) (skip string, err error)
	WantMoves   int
	WantDeletes int
	// Whether the request writes the new block.
	NewBlock bool
}

func replayPutNew(doc *Document) error {
	return doc.ReplaceBlock(&documents.Block{Id: replayNewBlock, Type: "Paragraph", Text: "x"})
}

var replaySteps = []replayStep{
	{
		Name: "relist",
		Run: func(doc *Document, m *replayModel) (string, error) {
			return "", m.relist(doc)
		},
	},
	{
		Name: "append-root", WantMoves: 1, NewBlock: true,
		Run: func(doc *Document, m *replayModel) (string, error) {
			var left string
			if roots := m.Levels[""]; len(roots) > 0 {
				left = roots[len(roots)-1]
			}

			if err := doc.MoveBlock(replayNewBlock, "", left); err != nil {
				return "", err
			}
			m.insert(replayNewBlock, "", left)

			return "", replayPutNew(doc)
		},
	},
	{
		Name: "insert-after-first-root", WantMoves: 1, NewBlock: true,
		Run: func(doc *Document, m *replayModel) (string, error) {
			roots := m.Levels[""]
			if len(roots) == 0 {
				return "no blocks", nil
			}

			if err := doc.MoveBlock(replayNewBlock, "", roots[0]); err != nil {
				return "", err
			}
			m.insert(replayNewBlock, "", roots[0])

			return "", replayPutNew(doc)
		},
	},
	{
		Name: "insert-child-largest-parent", WantMoves: 1, NewBlock: true,
		Run: func(doc *Document, m *replayModel) (string, error) {
			if m.Largest == "" {
				return "no nested blocks", nil
			}

			children := m.Levels[m.Largest]
			left := children[(len(children)-1)/2]

			if err := doc.MoveBlock(replayNewBlock, m.Largest, left); err != nil {
				return "", err
			}
			m.insert(replayNewBlock, m.Largest, left)

			return "", replayPutNew(doc)
		},
	},
	{
		Name: "insert-child-deepest", WantMoves: 1, NewBlock: true,
		Run: func(doc *Document, m *replayModel) (string, error) {
			if m.Deepest == "" {
				return "no blocks", nil
			}

			if err := doc.MoveBlock(replayNewBlock, m.Deepest, ""); err != nil {
				return "", err
			}
			m.insert(replayNewBlock, m.Deepest, "")

			return "", replayPutNew(doc)
		},
	},
	{
		Name: "move-last-root-to-front", WantMoves: 1,
		Run: func(doc *Document, m *replayModel) (string, error) {
			roots := m.Levels[""]
			if len(roots) < 2 {
				return "less than 2 root blocks", nil
			}

			last := roots[len(roots)-1]
			if err := doc.MoveBlock(last, "", ""); err != nil {
				return "", err
			}
			m.remove(last)
			m.insert(last, "", "")

			return "", nil
		},
	},
	{
		Name: "indent-second-root", WantMoves: 1,
		Run: func(doc *Document, m *replayModel) (string, error) {
			roots := m.Levels[""]
			if len(roots) < 2 {
				return "less than 2 root blocks", nil
			}

			var left string
			if children := m.Levels[roots[0]]; len(children) > 0 {
				left = children[len(children)-1]
			}

			second := roots[1]
			if err := doc.MoveBlock(second, roots[0], left); err != nil {
				return "", err
			}
			m.remove(second)
			m.insert(second, roots[0], left)

			return "", nil
		},
	},
	{
		Name: "delete-leaf", WantDeletes: 1,
		Run: func(doc *Document, m *replayModel) (string, error) {
			pairs := m.Pairs()
			if len(pairs) == 0 {
				return "no blocks", nil
			}

			// The last block in the reading order is always a leaf.
			leaf := pairs[len(pairs)-1].Child
			if err := doc.DeleteBlock(leaf); err != nil {
				return "", err
			}
			m.remove(leaf)

			return "", nil
		},
	},
	{
		// The whole document sent again with a new block at the end.
		Name: "relist-append-root", WantMoves: 1, NewBlock: true,
		Run: func(doc *Document, m *replayModel) (string, error) {
			var left string
			if roots := m.Levels[""]; len(roots) > 0 {
				left = roots[len(roots)-1]
			}

			m.Blocks[replayNewBlock] = &documents.Block{Id: replayNewBlock, Type: "Paragraph", Text: "x"}
			defer delete(m.Blocks, replayNewBlock)
			m.insert(replayNewBlock, "", left)

			return "", m.relist(doc)
		},
	},
	{
		// The whole document sent again with a new block after the first one.
		Name: "relist-insert-after-first-root", WantMoves: 1, NewBlock: true,
		Run: func(doc *Document, m *replayModel) (string, error) {
			roots := m.Levels[""]
			if len(roots) == 0 {
				return "no blocks", nil
			}

			m.Blocks[replayNewBlock] = &documents.Block{Id: replayNewBlock, Type: "Paragraph", Text: "x"}
			defer delete(m.Blocks, replayNewBlock)
			m.insert(replayNewBlock, "", roots[0])

			return "", m.relist(doc)
		},
	},
	{
		// The whole document sent again with the first block moved to the end.
		Name: "relist-first-root-to-end", WantMoves: 1,
		Run: func(doc *Document, m *replayModel) (string, error) {
			roots := m.Levels[""]
			if len(roots) < 2 {
				return "less than 2 root blocks", nil
			}

			first, last := roots[0], roots[len(roots)-1]
			m.remove(first)
			m.insert(first, "", last)

			return "", m.relist(doc)
		},
	},
	{
		// The whole document sent again without its last leaf, which is deleted.
		Name: "relist-delete-leaf", WantDeletes: 1,
		Run: func(doc *Document, m *replayModel) (string, error) {
			pairs := m.Pairs()
			if len(pairs) == 0 {
				return "no blocks", nil
			}

			leaf := pairs[len(pairs)-1].Child
			m.remove(leaf)

			if err := m.relist(doc); err != nil {
				return "", err
			}

			return "", doc.DeleteBlock(leaf)
		},
	},
	{
		// The root blocks in the reverse order: all of them but one have to move.
		Name: "relist-reverse-roots",
		Run: func(doc *Document, m *replayModel) (string, error) {
			roots := m.Levels[""]
			if len(roots) < 2 {
				return "less than 2 root blocks", nil
			}

			slices.Reverse(roots)
			m.ExtraMoves = len(roots) - 1

			return "", m.relist(doc)
		},
	},
	{
		// Every level in a random order: the fewest moves that get there must be stored.
		Name: "relist-shuffle-all-levels",
		Run: func(doc *Document, m *replayModel) (string, error) {
			if len(m.Blocks) < 2 {
				return "less than 2 blocks", nil
			}

			rng := rand.New(rand.NewSource(m.Seed)) //nolint:gosec

			parents := make([]string, 0, len(m.Levels))
			for parent := range m.Levels {
				parents = append(parents, parent)
			}
			slices.Sort(parents)

			for _, parent := range parents {
				children := m.Levels[parent]

				index := make(map[string]int, len(children))
				for i, c := range children {
					index[c] = i
				}

				rng.Shuffle(len(children), func(i, j int) { children[i], children[j] = children[j], children[i] })

				// Blocks that can stay are the longest run still in the initial order.
				var tails []int
				for _, c := range children {
					n, _ := slices.BinarySearch(tails, index[c])
					if n == len(tails) {
						tails = append(tails, index[c])
					} else {
						tails[n] = index[c]
					}
				}

				m.ExtraMoves += len(children) - len(tails)
			}

			return "", m.relist(doc)
		},
	},
	{
		// The first root block deleted with everything below it.
		Name: "delete-first-root-subtree",
		Run: func(doc *Document, m *replayModel) (string, error) {
			roots := m.Levels[""]
			if len(roots) == 0 {
				return "no blocks", nil
			}

			first := roots[0]

			var subtree []string
			var walk func(b string)
			walk = func(b string) {
				subtree = append(subtree, b)
				for _, c := range m.Levels[b] {
					walk(c)
				}
			}
			walk(first)

			for _, b := range subtree {
				if err := doc.DeleteBlock(b); err != nil {
					return "", err
				}
				delete(m.Levels, b)
			}

			m.remove(first)
			m.ExtraDeletes = len(subtree)

			return "", nil
		},
	},
	{
		// A deleted block put back at the end of the document.
		Name: "restore-deleted", WantMoves: 1,
		Run: func(doc *Document, m *replayModel) (string, error) {
			if len(m.Trashed) == 0 {
				return "no deleted blocks without children", nil
			}

			var left string
			if roots := m.Levels[""]; len(roots) > 0 {
				left = roots[len(roots)-1]
			}

			blk := m.Trashed[0]
			if err := doc.MoveBlock(blk, "", left); err != nil {
				return "", err
			}
			m.insert(blk, "", left)
			m.Ignore = map[string]struct{}{blk: {}}

			return "", nil
		},
	},
	{
		// Every map of the metadata cleared, and then all its entries set again to what they are.
		Name: "attrs-clear-then-set-same",
		Run: func(doc *Document, m *replayModel) (string, error) {
			if len(m.Maps) == 0 {
				return "no maps in the metadata that the API can write", nil
			}

			for _, k := range m.Maps {
				if err := doc.SetAttribute("", []string{k}, nil); err != nil {
					return "", err
				}

				for _, kv := range m.Meta {
					if kv.Key[0] != k {
						continue
					}

					if err := doc.SetAttribute("", kv.Key, kv.Value); err != nil {
						return "", err
					}
				}
			}

			return "", nil
		},
	},
	{
		// One map of the metadata cleared, and then its entries set again:
		// the first one to another value, the last one not at all.
		Name: "attrs-clear-then-set-changed",
		Run: func(doc *Document, m *replayModel) (string, error) {
			for _, k := range m.Maps {
				var entries []replayAttr
				for _, kv := range m.Meta {
					if kv.Key[0] == k {
						entries = append(entries, kv)
					}
				}

				if len(entries) < 2 {
					continue
				}

				if err := doc.SetAttribute("", []string{k}, nil); err != nil {
					return "", err
				}

				m.WantMetadata = m.Metadata.AsMap()
				m.WantAttrs = 2

				for i, kv := range entries {
					switch i {
					case 0:
						kv.Value = "replay-changed"
						replaySetKey(m.WantMetadata, kv.Key, kv.Value)
					case len(entries) - 1:
						replayPruneKey(m.WantMetadata, kv.Key)
						continue
					}

					if err := doc.SetAttribute("", kv.Key, kv.Value); err != nil {
						return "", err
					}
				}

				return "", nil
			}

			return "no map with 2 entries in the metadata that the API can write", nil
		},
	},
}

// replayPruneKey removes the value at the key path, and the maps left empty by that.
func replayPruneKey(m map[string]any, key []string) {
	if len(key) == 1 {
		delete(m, key[0])
		return
	}

	sub, ok := m[key[0]].(map[string]any)
	if !ok {
		return
	}

	replayPruneKey(sub, key[1:])
	if len(sub) == 0 {
		delete(m, key[0])
	}
}

func replaySetKey(m map[string]any, key []string, value any) {
	if len(key) == 1 {
		m[key[0]] = value
		return
	}

	replaySetKey(m[key[0]].(map[string]any), key[1:], value)
}

func (r *replayer) replayDocument(d replayDoc) {
	todo := false
	for _, s := range append([]replayStep{{Name: "load"}}, replaySteps...) {
		if len(r.steps) > 0 && s.Name != "load" && !slices.Contains(r.steps, s.Name) {
			continue
		}

		if _, ok := r.done[d.Key()+"|"+s.Name]; !ok {
			todo = true
		}
	}

	if !todo {
		return
	}

	base := replayRecord{IRI: d.Key(), Step: "load", Changes: d.NChanges}

	// Runs one step under the watchdog. Panics are recorded.
	run := func(rec *replayRecord, fn func()) {
		r.mu.Lock()
		r.current = *rec
		r.started = time.Now()
		r.mu.Unlock()

		defer func() {
			if p := recover(); p != nil {
				stack := strings.Split(string(debug.Stack()), "\n")
				rec.Panic = fmt.Sprint(p) + " @ " + replayPanicSite(stack)
				rec.OK = false
			}

			r.mu.Lock()
			r.started = time.Time{}
			if _, ok := r.done[rec.IRI+"|"+rec.Step]; !ok {
				r.write(*rec)
			}
			r.mu.Unlock()
		}()

		fn()
	}

	var (
		changes []replayChange
		model   *replayModel
	)

	run(&base, func() {
		var err error
		changes, err = r.loadChanges(d)
		if err != nil {
			base.Err = "load changes: " + err.Error()
			return
		}

		if d.Prefix > 0 {
			changes = changes[:min(d.Prefix, len(changes))]
			base.Changes = len(changes)
		}

		start := time.Now()
		doc, err := replayLoad(d.IRI, changes)
		if err != nil {
			base.Err = err.Error()
			return
		}
		base.LoadNs = time.Since(start).Nanoseconds()

		docpb, err := doc.Hydrate(context.Background())
		if err != nil {
			base.Err = "hydrate: " + err.Error()
			return
		}

		model = newReplayModel(docpb, doc)

		state := doc.crdt.tree.State()
		base.Heads = len(doc.Heads())
		base.Blocks = len(model.Blocks)
		base.Depth = model.Depth
		base.Detached = len(docpb.DetachedBlocks)
		base.MetaKeys = len(model.Meta)
		base.MetaSkipped = model.MetaSkipped
		base.MetaCompound = model.MetaCompound
		base.NoContent = len(model.NoContent)
		base.MoveLog = state.opSet.log.Len()
		base.Invisible = state.invisibleMoves.Len()

		for _, children := range model.Levels {
			base.MaxLevel = max(base.MaxLevel, len(children))
		}

		for _, bs := range state.blocks {
			if bs.Parent == TrashNodeID {
				base.Trashed++
			}
		}

		// What is read must be what the tree says.
		if !slices.Equal(model.Pairs(), slices.Collect(state.DFT(""))) {
			base.Fail = "hydrated tree differs from the tree state"
			return
		}

		base.OK = true
	})

	if model == nil || !base.OK {
		return
	}

	for _, step := range replaySteps {
		if _, ok := r.done[d.Key()+"|"+step.Name]; ok {
			continue
		}

		if len(r.steps) > 0 && !slices.Contains(r.steps, step.Name) {
			continue
		}

		rec := base
		rec.Step = step.Name
		rec.OK = false
		rec.LoadNs = 0
		rec.WantMoves = step.WantMoves
		rec.WantDeletes = step.WantDeletes

		if r.hangs[d.Key()] >= r.maxHang {
			rec.Skipped = "document timed out on other steps"
			rec.Hang = true
			r.write(rec)
			continue
		}

		run(&rec, func() { r.replayStep(d, changes, model, step, &rec) })
	}
}

// replayPanicSite returns the first frame of the stack that's in the code under test.
func replayPanicSite(stack []string) string {
	for i, line := range stack {
		if strings.Contains(line, "/docmodel/") && !strings.Contains(line, "replay_real_test.go") && i > 0 {
			return strings.TrimSpace(stack[i-1]) + " " + strings.TrimSpace(line)
		}
	}

	return ""
}

func (r *replayer) replayStep(d replayDoc, changes []replayChange, initial *replayModel, step replayStep, rec *replayRecord) {
	doc, err := replayLoad(d.IRI, changes)
	if err != nil {
		rec.Err = "load: " + err.Error()
		return
	}

	want := initial.Copy()

	start := time.Now()
	skip, err := step.Run(doc, want)
	rec.RequestNs = time.Since(start).Nanoseconds()
	if err != nil {
		rec.Err = "request: " + err.Error()
		return
	}

	if skip != "" {
		rec.Skipped = skip
		rec.OK = true
		return
	}

	wantMoves := step.WantMoves + want.ExtraMoves
	wantDeletes := step.WantDeletes + want.ExtraDeletes
	rec.WantMoves, rec.WantDeletes = wantMoves, wantDeletes

	kp := coretest.NewTester("alice").Account

	start = time.Now()
	change, err := doc.CreateChange(kp, time.Now())
	rec.CommitNs = time.Since(start).Nanoseconds()
	if err != nil {
		rec.Err = "create change: " + err.Error()
		return
	}

	rec.Bytes = len(change.Data)

	// What is stored is what the encoded bytes say.
	stored := &blob.Change{}
	if err := cbornode.DecodeInto(change.Data, stored); err != nil {
		rec.Err = "decode stored change: " + err.Error()
		return
	}

	var (
		fails    []string
		moved    = map[string]int{}
		deleted  = map[string]int{}
		replaced = map[string]int{}
	)

	for op, err := range stored.Ops() {
		if err != nil {
			rec.Err = "stored op: " + err.Error()
			return
		}

		switch op := op.(type) {
		case blob.OpMoveBlocks:
			rec.MoveOps++
			rec.Moves += len(op.Blocks)
			for _, b := range op.Blocks {
				moved[b]++
			}
		case blob.OpDeleteBlocks:
			rec.Deletes += len(op.Blocks)
			for _, b := range op.Blocks {
				deleted[b]++
			}
		case blob.OpReplaceBlock:
			rec.Replaces++
			replaced[op.Block.ID()]++
		case blob.OpSetAttributes:
			rec.Attrs += len(op.Attrs)
			for _, kv := range op.Attrs {
				rec.Detail = append(rec.Detail, "attr:"+strings.Join(kv.Key, "."))
			}
		default:
			fails = append(fails, fmt.Sprintf("unexpected op %T", op))
		}
	}

	if rec.Moves != wantMoves {
		fails = append(fails, "moves")
	}

	if rec.Deletes != wantDeletes {
		fails = append(fails, "deletes")
	}

	wantReplaces := 0
	if step.NewBlock {
		wantReplaces = 1
	}

	if rec.Replaces != wantReplaces {
		fails = append(fails, "replaces")
	}

	if rec.Attrs != want.WantAttrs {
		fails = append(fails, "attrs")
	}

	for b, n := range moved {
		if n > 1 {
			fails = append(fails, "duplicated-move")
		}

		if rec.Moves != wantMoves && len(rec.Detail) < 20 {
			rec.Detail = append(rec.Detail, "move:"+b)
		}
	}

	for b := range deleted {
		if rec.Deletes != wantDeletes && len(rec.Detail) < 20 {
			rec.Detail = append(rec.Detail, "delete:"+b)
		}
	}

	for b := range replaced {
		if b != replayNewBlock && len(rec.Detail) < 20 {
			rec.Detail = append(rec.Detail, "replace:"+b)
		}
	}

	// The change can't be much bigger than what it has to say: one small block, and the expected moves and deletes.
	if rec.Bytes > 1024+64*(wantMoves+wantDeletes) {
		fails = append(fails, "bytes")
	}

	wantPairs := want.Pairs()

	// Tree the mutation had in memory.
	if doc.mut != nil {
		if !slices.Equal(wantPairs, slices.Collect(doc.mut.dirty.DFT(""))) {
			fails = append(fails, "mutation-tree")
		}
	}

	// Tree others read: a replica that never saw the mutation, only the stored bytes.
	replica, err := replayLoad(d.IRI, append(slices.Clone(changes), replayChange{CID: change.CID, Data: change.Data}))
	if err != nil {
		rec.Err = "replica: " + err.Error()
		return
	}

	if !slices.Equal(wantPairs, slices.Collect(replica.crdt.tree.State().DFT(""))) {
		fails = append(fails, "replica-tree")
	}

	docpb, err := replica.Hydrate(context.Background())
	if err != nil {
		rec.Err = "replica hydrate: " + err.Error()
		return
	}

	got := newReplayModel(docpb, replica)

	if !slices.Equal(wantPairs, got.Pairs()) {
		fails = append(fails, "replica-hydrated-tree")
	}

	// Content of the blocks that were there must be read the same, revision included.
	contentDiffs := 0
	for id, blk := range got.Blocks {
		if id == replayNewBlock {
			continue
		}

		if _, ok := want.Ignore[id]; ok {
			continue
		}

		if !proto.Equal(blk, initial.Blocks[id]) {
			contentDiffs++
			if len(rec.Detail) < 20 {
				rec.Detail = append(rec.Detail, "content:"+id)
			}
		}
	}

	if contentDiffs > 0 {
		fails = append(fails, "replica-content")
	}

	wantMetadata := initial.Metadata
	if want.WantMetadata != nil {
		wantMetadata, err = structpb.NewStruct(want.WantMetadata)
		if err != nil {
			rec.Err = "expected metadata: " + err.Error()
			return
		}
	}

	if !proto.Equal(got.Metadata, wantMetadata) {
		fails = append(fails, "replica-metadata")
	}

	slices.Sort(fails)
	fails = slices.Compact(fails)
	slices.Sort(rec.Detail)

	rec.Fail = strings.Join(fails, ",")
	rec.OK = len(fails) == 0
}

// replayBitmapIDs decodes the roaring bitmap of change IDs of a document generation.
func replayBitmapIDs(raw []byte) ([]int64, error) {
	if len(raw) == 0 {
		return nil, nil
	}

	bm := roaring64.New()
	if _, err := bm.FromUnsafeBytes(slices.Clone(raw)); err != nil {
		return nil, fmt.Errorf("failed to parse bitmap: %w", err)
	}

	var ids []int64

	it := bm.Iterator()
	for it.HasNext() {
		ids = append(ids, int64(it.Next())) //nolint:gosec
	}

	return ids, nil
}
