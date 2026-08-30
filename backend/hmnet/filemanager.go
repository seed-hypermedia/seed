package hmnet

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"seed/backend/blob"
	"seed/backend/ipfs"
	"strconv"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"github.com/ipfs/boxo/blockservice"
	blockstore "github.com/ipfs/boxo/blockstore"
	"github.com/ipfs/boxo/exchange"
	"github.com/ipfs/boxo/files"
	"github.com/ipfs/boxo/ipld/merkledag"
	unixfile "github.com/ipfs/boxo/ipld/unixfs/file"
	"github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	ipld "github.com/ipfs/go-ipld-format"
	"github.com/multiformats/go-multicodec"
	"github.com/multiformats/go-multihash"
	"go.uber.org/zap"
)

const (
	// MaxFileBytes is the maximum file size in bytes to be uploaded.
	MaxFileBytes = 150 * 1024 * 1024 // 150 MiB.
	// SearchTimeout is the maximum time we are searching for a file.
	SearchTimeout = 30 * time.Second
	// PublicIPFSCacheControl is used for content the daemon can prove is public.
	PublicIPFSCacheControl = "public, max-age=29030400, immutable"
	// PrivateIPFSCacheControl permits browser caching but prevents shared CDN caches from storing private content.
	PrivateIPFSCacheControl = "private, max-age=29030400, immutable"
	// DefaultContentType is served when the type of a file can't be determined.
	DefaultContentType = "application/octet-stream"
	// SandboxContentSecurityPolicy is sent with any file whose type could carry script (SVG, XML, text, unknown binaries),
	// so that navigating to the file directly renders it in an opaque origin with no script execution.
	// Without it, an uploaded SVG or HTML file would run as the daemon's own origin and could call its API.
	// Loading such a file in <img> is unaffected: images never execute script anyway.
	SandboxContentSecurityPolicy = "sandbox"

	// sniffBytes is how much of the file is inspected to determine its type.
	// This is what the detector reads at most; more doesn't improve accuracy.
	sniffBytes = 3072
)

// PublicCIDChecker checks whether a CID is publicly cacheable.
type PublicCIDChecker interface {
	// IsPublicCID reports whether a stored blob is marked as public.
	IsPublicCID(ctx context.Context, c cid.Cid) (bool, error)
}

// FileManager is the main object to handle ipfs files.
type FileManager struct {
	log              *zap.Logger
	bs               blockstore.Blockstore
	dagService       ipld.DAGService
	publicCIDChecker PublicCIDChecker
}

// NewFileManager creates a new fileManager instance.
func NewFileManager(log *zap.Logger, bs blockstore.Blockstore, bitswap exchange.Interface, publicCIDChecker PublicCIDChecker) *FileManager {
	bsvc := blockservice.New(bs, bitswap)
	// Don't close the blockservice, because it doesn't do anything useful.
	// It's actually closing the exchange, which is not even its responsibility.
	// The whole blockservice interface is just bad, and IPFS keeps talking about removing it,
	// but I guess it's too engrained everywhere to remove easily.

	dag := merkledag.NewDAGService(bsvc)

	return &FileManager{
		log:              log,
		bs:               bs,
		dagService:       dag,
		publicCIDChecker: publicCIDChecker,
	}
}

// GetFile retrieves a file from ipfs.
func (fm *FileManager) GetFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Accept-Ranges", "bytes")

	if r.Method != "GET" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		fmt.Fprintf(w, "Only GET method is supported.")
		return
	}
	cidStr := r.PathValue("cid")
	if cidStr == "" {
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

	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()

	n, err := fm.dagService.Get(ctx, cid)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			w.WriteHeader(http.StatusRequestTimeout)
		} else if blob.IsPublicOnlyDenied(err) {
			w.WriteHeader(http.StatusNotFound)
		} else if ipld.IsNotFound(err) {
			w.WriteHeader(http.StatusNotFound)
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
		ufsNode, err := unixfile.NewUnixfsFile(ctx, fm.dagService, n)
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

	filename := r.URL.Query().Get("filename")

	// IPFS addresses bytes, not files: nothing in the DAG says what the content is.
	// The type is a property of the bytes, so derive it from them at the one place that serves them,
	// rather than asking every writer to record it and every reader to trust that record.
	// A download name, when the caller gives one, wins because it's what the user will see.
	head, body, err := peekHead(response)
	if err != nil {
		fm.log.Warn("GetFile: failed to read file head", zap.Error(err), zap.String("cid", cidStr))
		http.Error(w, "Could not read the data with the given CID: "+err.Error(), http.StatusInternalServerError)
		return
	}
	response = body
	contentType := ContentTypeFor(filename, head)

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if !isInertContentType(contentType) {
		w.Header().Set("Content-Security-Policy", SandboxContentSecurityPolicy)
	}
	w.Header().Set("ETag", cidStr)
	w.Header().Set("Cache-Control", fm.cacheControlForCID(ctx, cid))

	if filename != "" {
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

// peekHead reads the beginning of r for type detection and hands back a reader
// positioned at the start of the content again. Seekable readers (UnixFS files,
// raw blocks) are rewound so that range requests can still seek on them; anything
// else gets the consumed bytes stitched back in front.
func peekHead(r io.Reader) ([]byte, io.Reader, error) {
	head := make([]byte, sniffBytes)
	n, err := io.ReadFull(r, head)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		return nil, nil, err
	}
	head = head[:n]

	if s, ok := r.(io.Seeker); ok {
		if _, err := s.Seek(0, io.SeekStart); err == nil {
			return head, r, nil
		}
	}

	return head, io.MultiReader(bytes.NewReader(head), r), nil
}

// ContentTypeFor determines the Content-Type to serve for a file.
// A filename with a known extension takes precedence; otherwise the type is
// detected from the leading bytes of the content, falling back to DefaultContentType.
// Types that would render as a document on the daemon's origin (HTML) are downgraded to plain text.
func ContentTypeFor(filename string, head []byte) string {
	if ext := path.Ext(filename); ext != "" {
		if t := mime.TypeByExtension(ext); t != "" {
			return neuterContentType(t)
		}
	}

	if len(head) == 0 {
		return DefaultContentType
	}

	return neuterContentType(mimetype.Detect(head).String())
}

// neuterContentType replaces types the browser would render as an active document with plain text.
// There's no reason for the daemon to ever serve a page, and doing so would be a stored XSS on its origin.
func neuterContentType(contentType string) string {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return DefaultContentType
	}

	switch mediaType {
	case "text/html", "application/xhtml+xml":
		return "text/plain; charset=utf-8"
	}

	return contentType
}

// isInertContentType reports whether a type is rendered by the browser without
// any possibility of script execution, so it needs no Content-Security-Policy.
// SVG is an image that can carry <script>, so it's deliberately not in this set.
func isInertContentType(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}

	if mediaType == "image/svg+xml" {
		return false
	}

	switch {
	case strings.HasPrefix(mediaType, "image/"),
		strings.HasPrefix(mediaType, "video/"),
		strings.HasPrefix(mediaType, "audio/"),
		strings.HasPrefix(mediaType, "font/"),
		mediaType == "application/pdf":
		return true
	}

	return false
}

func (fm *FileManager) cacheControlForCID(ctx context.Context, c cid.Cid) string {
	if fm.publicCIDChecker == nil {
		return PrivateIPFSCacheControl
	}
	isPublic, err := fm.publicCIDChecker.IsPublicCID(ctx, c)
	if err != nil {
		fm.log.Warn("GetFile: failed to determine cache policy", zap.Error(err), zap.String("cid", c.String()))
		return PrivateIPFSCacheControl
	}
	if !isPublic {
		return PrivateIPFSCacheControl
	}
	return PublicIPFSCacheControl
}

// PutBlob stores a raw IPFS block uploaded by the client.
// The CID in the URL must match the actual content; mismatches are rejected.
func (fm *FileManager) PutBlob(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Only POST method is supported.", http.StatusMethodNotAllowed)
		return
	}

	cidStr := r.PathValue("cid")
	if cidStr == "" {
		http.Error(w, "URL format not recognized.", http.StatusBadRequest)
		return
	}

	declared, err := cid.Decode(cidStr)
	if err != nil {
		http.Error(w, fmt.Sprintf("Invalid CID %q: %v", cidStr, err), http.StatusBadRequest)
		return
	}

	data, err := io.ReadAll(io.LimitReader(r.Body, MaxFileBytes))
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read body: %v", err), http.StatusBadRequest)
		return
	}

	// Verify the data matches the declared CID by recomputing the multihash.
	mh := declared.Hash()
	decoded, err := multihash.Decode(mh)
	if err != nil {
		http.Error(w, fmt.Sprintf("Cannot decode multihash: %v", err), http.StatusBadRequest)
		return
	}
	computed, err := multihash.Sum(data, decoded.Code, decoded.Length)
	if err != nil {
		http.Error(w, fmt.Sprintf("Cannot compute hash: %v", err), http.StatusBadRequest)
		return
	}
	if !bytes.Equal(mh, computed) {
		http.Error(w, "CID mismatch: data does not match declared CID", http.StatusBadRequest)
		return
	}

	blk, err := blocks.NewBlockWithCid(data, declared)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create block: %v", err), http.StatusInternalServerError)
		return
	}

	if err := fm.bs.Put(r.Context(), blk); err != nil {
		http.Error(w, fmt.Sprintf("Failed to store block: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

// UploadFile uploads a file to ipfs.
func (fm *FileManager) UploadFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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
	_, _ = w.Write([]byte(n.Cid().String()))
}

// addFile chunks and adds content to the DAGService from a reader. The content
// is stored as a UnixFS DAG (default for IPFS). It returns the root ipld.Node.
func (fm *FileManager) addFile(r io.Reader) (ipld.Node, error) {
	return ipfs.WriteUnixFSFile(fm.dagService, r)
}
