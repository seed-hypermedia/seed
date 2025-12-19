package hmnet

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"seed/backend/blob"
	"seed/backend/ipfs"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/ipfs/boxo/blockservice"
	blockstore "github.com/ipfs/boxo/blockstore"
	"github.com/ipfs/boxo/exchange"
	"github.com/ipfs/boxo/files"
	"github.com/ipfs/boxo/ipld/merkledag"
	unixfile "github.com/ipfs/boxo/ipld/unixfs/file"
	"github.com/ipfs/go-cid"
	ipld "github.com/ipfs/go-ipld-format"
	"github.com/multiformats/go-multicodec"
	"go.uber.org/zap"
)

const (
	// MaxFileBytes is the maximum file size in bytes to be uploaded.
	MaxFileBytes = 150 * 1024 * 1024 // 150 MiB.
	// SearchTimeout is the maximum time we are searching for a file.
	SearchTimeout = 30 * time.Second
)

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
	w.Header().Set("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Cache-Control, ETag, Range")
	w.Header().Set("Access-Control-Allow-Methods", "OPTIONS, GET")
	w.Header().Set("Accept-Ranges", "bytes")

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

	// If the request is not coming from localhost (i.e. it's not from our Electron app),
	// then we only serve public data, because for now private data is not available on the web.
	// TODO(burdiyan): think about how we can authenticate private data requests on the web.
	if !isLocalhost(r) {
		ctx = blob.WithPublicOnly(ctx)
	}

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
	var size int64
	codec, _ := ipfs.DecodeCID(n.Cid())
	if codec == multicodec.DagPb {
		ufsNode, err := unixfile.NewUnixfsFile(ctx, fm.DAGService, n)
		if err != nil {
			response = bytes.NewReader(n.RawData())
			size = int64(len(n.RawData()))
		} else {
			f, ok := ufsNode.(files.File)
			if ok {
				response = f
				if s, ok := f.(io.Seeker); ok {
					// Get the size if we can seek
					if size, err = s.Seek(0, io.SeekEnd); err == nil {
						_, err = s.Seek(0, io.SeekStart)
					}
					if err != nil {
						fm.log.Warn("GetFile: failed to get file size", zap.Error(err), zap.String("cid", cidStr))
						size = -1
					}
				} else {
					size = -1
				}
			} else {
				response = bytes.NewReader(n.RawData())
				size = int64(len(n.RawData()))
			}
		}
	} else {
		response = bytes.NewReader(n.RawData())
		size = int64(len(n.RawData()))
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("ETag", cidStr)
	w.Header().Set("Cache-Control", "public, max-age=29030400, immutable")

	if filename := r.URL.Query().Get("filename"); filename != "" {
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	}

	// Handle range requests if we know the size
	if size >= 0 {
		rangeHeader := r.Header.Get("Range")
		if rangeHeader != "" {
			// Parse the range header
			rangeStr := strings.TrimPrefix(rangeHeader, "bytes=")
			parts := strings.Split(rangeStr, "-")
			if len(parts) != 2 {
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}

			start, err := strconv.ParseInt(parts[0], 10, 64)
			if err != nil {
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}

			var end int64
			if parts[1] == "" {
				end = size - 1
			} else {
				end, err = strconv.ParseInt(parts[1], 10, 64)
				if err != nil {
					w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
					return
				}
			}

			// Validate range
			if start < 0 || end >= size || start > end {
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}

			// Set up the response for a range request
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
			w.WriteHeader(http.StatusPartialContent)

			// If we can seek, use that to get the range
			if seeker, ok := response.(io.Seeker); ok {
				if _, err := seeker.Seek(start, io.SeekStart); err != nil {
					fm.log.Warn("GetFile: failed to seek to range start", zap.Error(err), zap.String("cid", cidStr))
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				response = io.LimitReader(response, end-start+1)
			} else {
				// If we can't seek, we need to read and discard up to start
				_, err := io.CopyN(io.Discard, response, start)
				if err != nil {
					fm.log.Warn("GetFile: failed to seek to range start", zap.Error(err), zap.String("cid", cidStr))
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				response = io.LimitReader(response, end-start+1)
			}
		} else {
			w.WriteHeader(http.StatusOK)
		}
	} else {
		w.WriteHeader(http.StatusOK)
	}

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
	return ipfs.WriteUnixFSFile(fm.DAGService, r)
}

func isLocalhost(r *http.Request) bool {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	return ip == "127.0.0.1" || ip == "::1"
}
