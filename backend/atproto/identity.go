package atproto

import (
	"context"
	"fmt"
	"net/url"
)

// ResolveHandle resolves a handle to a DID.
func (c *Client) ResolveHandle(ctx context.Context, handle string) (string, error) {
	params := url.Values{}
	params.Set("handle", handle)

	var result struct {
		DID string `json:"did"`
	}

	err := c.xrpcCall(ctx, "GET", "com.atproto.identity.resolveHandle", params, nil, &result)
	if err != nil {
		return "", fmt.Errorf("resolve handle: %w", err)
	}

	return result.DID, nil
}

// DescribeRepo returns information about a repo/account.
func (c *Client) DescribeRepo(ctx context.Context, repo string) (*RepoDescription, error) {
	params := url.Values{}
	params.Set("repo", repo)

	var result RepoDescription
	err := c.xrpcCall(ctx, "GET", "com.atproto.repo.describeRepo", params, nil, &result)
	if err != nil {
		return nil, fmt.Errorf("describe repo: %w", err)
	}

	return &result, nil
}

// RepoDescription contains information about a repository.
type RepoDescription struct {
	Handle                 string   `json:"handle"`
	DID                    string   `json:"did"`
	DIDDoc                 any      `json:"didDoc"`
	Collections            []string `json:"collections"`
	HandleIsCorrect        bool     `json:"handleIsCorrect"`
}

// GetServiceEndpoint resolves the PDS endpoint for a DID.
// This is useful for accounts that might be on a different PDS.
func (c *Client) GetServiceEndpoint(ctx context.Context, did string) (string, error) {
	// For now, we'll use the current PDS
	// In a full implementation, this would resolve the DID document
	// and extract the atproto_pds service endpoint
	return c.pdsURL, nil
}
