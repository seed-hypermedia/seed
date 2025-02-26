package hmnet

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"seed/backend/ipfs"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/ipfs/boxo/blockservice"
	blockstore "github.com/ipfs/boxo/blockstore"
	chunker "github.com/ipfs/boxo/chunker"
	"github.com/ipfs/boxo/exchange"
	"github.com/ipfs/boxo/files"
	"github.com/ipfs/boxo/ipld/merkledag"
	unixfile "github.com/ipfs/boxo/ipld/unixfs/file"
	"github.com/ipfs/boxo/ipld/unixfs/importer/balanced"
	"github.com/ipfs/boxo/ipld/unixfs/importer/helpers"
	"github.com/ipfs/go-cid"
	ipld "github.com/ipfs/go-ipld-format"
	"github.com/multiformats/go-multicodec"
	multihash "github.com/multiformats/go-multihash"
	"go.uber.org/zap"
)

const (
	// MaxFileBytes is the maximum file size in bytes to be uploaded.
	MaxFileBytes = 150 * 1024 * 1024 // 150 MiB.
	// SearchTimeout is the maximum time we are searching for a file.
	SearchTimeout = 30 * time.Second
)

// AddParams contains all of the configurable parameters needed to specify the
// importing process of a file.
type AddParams struct {
	Layout    string
	Chunker   string
	RawLeaves bool
	Hidden    bool
	Shard     bool
	NoCopy    bool
	HashFun   string
}

// HTTPHandler is an interface to pass to the router only the http handlers and
// not all the FileManager type.
type HTTPHandler interface {
	GetFile(http.ResponseWriter, *http.Request)
	UploadFile(http.ResponseWriter, *http.Request)
}

// FileManager is the main object to handle ipfs files.
type FileManager struct {
	log        *zap.Logger
	DAGService ipld.DAGService
}

// NewFileManager creates a new fileManager instance.
func NewFileManager(log *zap.Logger, bs blockstore.Blockstore, bitswap exchange.Interface) *FileManager {
	bsvc := blockservice.New(bs, bitswap)
	// Don't close the blockservice, because it doesn't do anything useful.
	// It's actually closing the exchange, which is not even its responsibility.
	// The whole blockservice interface is just bad, and IPFS keeps talking about removing it,
	// but I guess it's too engrained everywhere to remove easily.

	dag := merkledag.NewDAGService(bsvc)

	return &FileManager{
		log:        log,
		DAGService: dag,
	}
}

// GetFile retrieves a file from ipfs.
func (fm *FileManager) GetFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Cache-Control, ETag")
	w.Header().Set("Access-Control-Allow-Methods", "OPTIONS, GET")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "GET" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		fmt.Fprintf(w, "Only GET method is supported.")
		return
	}
	vars := mux.Vars(r)
	cidStr, ok := vars["cid"]
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, "URL format not recognized.")
		return
	}
	cid, err := cid.Decode(cidStr)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, "Failed to decode CID %s: %v.", cidStr, err)
		return
	}

	ctx := r.Context()

	n, err := fm.DAGService.Get(ctx, cid)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			w.WriteHeader(http.StatusRequestTimeout)
		} else {
			w.WriteHeader(http.StatusInternalServerError)
		}
		fmt.Fprintf(w, "Could not get the data with the given CID %s: %v", cid, err)
		return
	}

	// If the CID is not a UnixFS file we want to return the raw bytes.
	// Otherwise we assemble the file and return it as a file.
	var response io.Reader
	codec, _ := ipfs.DecodeCID(n.Cid())
	if codec == multicodec.DagPb {
		ufsNode, err := unixfile.NewUnixfsFile(ctx, fm.DAGService, n)
		if err != nil {
			response = bytes.NewReader(n.RawData())
		} else {
			f, ok := ufsNode.(files.File)
			if ok {
				response = f
			} else {
				response = bytes.NewReader(n.RawData())
			}
		}
	} else {
		response = bytes.NewReader(n.RawData())
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("ETag", cidStr)
	w.Header().Set("Cache-Control", "public, max-age=29030400, immutable")
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, response); err != nil {
		fm.log.Warn("GetFile: failed to write response in full", zap.Error(err), zap.String("cid", cidStr))
	}
}

// UploadFile uploads a file to ipfs.
func (fm *FileManager) UploadFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
	w.Header().Set("Access-Control-Allow-Methods", "PUT, POST, OPTIONS")

	if r.Method != "POST" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		fmt.Fprintf(w, "Only POST method is supported.")
		return
	}

	if r.ContentLength > MaxFileBytes {
		http.Error(w, "File too large", http.StatusRequestEntityTooLarge)
		return
	}

	if err := r.ParseMultipartForm(MaxFileBytes); err != nil {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		fmt.Fprintf(w, "Parse body error: %s", err.Error())
		return
	}

	f, _, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprintf(w, "Error Retrieving file to upload: %v", err.Error())
		return
	}
	defer f.Close()

	n, err := fm.addFile(f)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprintf(w, "Failed to add file to the IPFS blockstore: %v", err.Error())
		return
	}

	w.WriteHeader(http.StatusCreated)
	w.Header().Add("Content-Type", "text/plain")
	w.Write([]byte(n.Cid().String()))
}

// addFile chunks and adds content to the DAGService from a reader. The content
// is stored as a UnixFS DAG (default for IPFS). It returns the root ipld.Node.
func (fm *FileManager) addFile(r io.Reader) (ipld.Node, error) {
	params := &AddParams{}

	prefix, err := merkledag.PrefixForCidVersion(1)
	if err != nil {
		return nil, fmt.Errorf("bad CID Version: %w", err)
	}

	hashFunCode, ok := multihash.Names[strings.ToLower("sha2-256")]
	if !ok {
		return nil, fmt.Errorf("unrecognized hash function: %s", "sha2-256")
	}
	prefix.MhType = hashFunCode
	prefix.MhLength = -1

	dbp := helpers.DagBuilderParams{
		Dagserv:    fm.DAGService,
		RawLeaves:  true, // Leave the actual file bytes untouched instead of wrapping them in a dag-pb protobuf wrapper
		Maxlinks:   helpers.DefaultLinksPerBlock,
		NoCopy:     false,
		CidBuilder: &prefix,
	}

	chnk, err := chunker.FromString(r, params.Chunker)
	if err != nil {
		return nil, err
	}
	dbh, err := dbp.New(chnk)
	if err != nil {
		return nil, err
	}

	var n ipld.Node
	n, err = balanced.Layout(dbh)
	return n, err
}
