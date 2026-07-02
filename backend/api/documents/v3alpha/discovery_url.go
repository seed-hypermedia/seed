package documents

import (
	"errors"
	"fmt"
	"net/url"
	"seed/backend/blob"
	"seed/backend/core"
	"strings"
)

// discoveryTarget is the parsed shape of a DiscoverResourceRequest.id URL.
//
// Wildcards (* and **) collapse into the depth-one and recursive flags.
// Scope keywords (e.g. :profile) map via discoveryScopes to a server-owned
// blob-type allowlist. Scope keywords and wildcards are mutually exclusive
// in a single URL — the parser returns an error if both are present.
type discoveryTarget struct {
	IRI       blob.IRI // canonical IRI of the base (no wildcard or scope suffix).
	Recursive bool     // true when the URL ends with /** wildcard.
	DepthOne  bool     // true when the URL ends with /* wildcard.
	BlobTypes []string // blob-type allowlist implied by a scope suffix; nil = all.
}

// discoveryScopes maps URL scope keywords to the server-side blob-type
// allowlist they imply. Frontend callers never see the raw blob-type names
// — they only refer to scopes by keyword, and the server owns the mapping.
var discoveryScopes = map[string][]string{
	"profile": {"Profile", "Ref", "Change"},
}

// parseDiscoveryURL parses an hm:// discovery URL into its components.
//
// Recognized forms:
//
//	hm://ACCOUNT_ID                      — exact root, all blob types
//	hm://ACCOUNT_ID/path                 — exact path, all blob types
//	hm://ACCOUNT_ID/path/*               — direct children of path (depth=1)
//	hm://ACCOUNT_ID/path/**              — path and all descendants
//	hm://ACCOUNT_ID/:profile             — profile blobs at root
//	hm://ACCOUNT_ID/path:profile         — profile blobs at path
//
// Wildcards must be the final path segment (`*` or `**` exactly, not embedded
// or combined with other characters). Scope keywords must be a suffix of the
// final segment (after the final `/`) introduced by a colon. Unknown keywords
// are treated as path content rather than rejected, so paths that happen to
// contain a colon stay valid.
func parseDiscoveryURL(s string) (discoveryTarget, error) {
	if s == "" {
		return discoveryTarget{}, errors.New("empty URL")
	}

	u, err := url.Parse(s)
	if err != nil {
		return discoveryTarget{}, fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "hm" {
		return discoveryTarget{}, fmt.Errorf("scheme must be hm://, got %q", u.Scheme)
	}
	if u.Host == "" {
		return discoveryTarget{}, errors.New("missing account id")
	}

	acc, err := core.DecodePrincipal(u.Host)
	if err != nil {
		return discoveryTarget{}, fmt.Errorf("bad account id: %w", err)
	}

	// Normalize: drop a single trailing slash. Real Seed paths never end
	// with '/', and url.Parse keeps it for "hm://acc/".
	path := strings.TrimSuffix(u.Path, "/")

	var t discoveryTarget

	switch {
	case strings.HasSuffix(path, "/**"):
		t.Recursive = true
		path = path[:len(path)-len("/**")]
	case strings.HasSuffix(path, "/*"):
		t.DepthOne = true
		path = path[:len(path)-len("/*")]
	default:
		// Scope keyword lives in the final path segment, after a colon.
		lastSlash := strings.LastIndex(path, "/")
		lastSeg := path[lastSlash+1:]
		if colon := strings.LastIndex(lastSeg, ":"); colon >= 0 {
			keyword := lastSeg[colon+1:]
			if blobTypes, ok := discoveryScopes[keyword]; ok {
				prefix := lastSeg[:colon]
				if prefix == "*" || prefix == "**" {
					return discoveryTarget{}, errors.New("scope keyword and wildcards are mutually exclusive")
				}
				t.BlobTypes = blobTypes
				path = path[:lastSlash+1+colon]
			}
		}
	}

	// After stripping any suffix, normalize a trailing slash again. This
	// covers "hm://ACC/:profile" → path "/:profile" → strip ":profile" → "/".
	path = strings.TrimSuffix(path, "/")

	iri, err := blob.NewIRI(acc, path)
	if err != nil {
		return discoveryTarget{}, fmt.Errorf("bad IRI: %w", err)
	}
	t.IRI = iri
	return t, nil
}
