package ebay

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	json "encoding/json/v2"
)

const scope = "https://api.ebay.com/oauth/api_scope"

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	TokenType   string `json:"token_type"`
}

// token returns a cached application token, fetching one only when the current
// token is missing or close to expiry.
func (c *Client) token(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.accessToken != "" && time.Now().Before(c.tokenExpiry) {
		return c.accessToken, nil
	}

	form := url.Values{"grant_type": {"client_credentials"}, "scope": {scope}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/identity/v1/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(c.clientID, c.clientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("ebay oauth: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("ebay oauth: unexpected status %s", resp.Status)
	}
	var tr tokenResponse
	if err := json.UnmarshalRead(resp.Body, &tr); err != nil {
		return "", fmt.Errorf("ebay oauth: decode: %w", err)
	}
	if tr.AccessToken == "" {
		return "", fmt.Errorf("ebay oauth: empty access token")
	}

	c.accessToken = tr.AccessToken
	lifetime := time.Duration(tr.ExpiresIn) * time.Second
	c.tokenExpiry = time.Now().Add(lifetime - time.Minute)
	return c.accessToken, nil
}
