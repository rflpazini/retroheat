package ebay

import (
	"context"
	"fmt"
	"net/http"
	"time"

	json "encoding/json/v2"
)

// Quota is what is left of the application's daily Browse allowance. Every
// tool on the keyset (this collector, audits, the barcode index) draws on the
// same 5,000 calls, and a run that meets the limit halfway fails every game
// after it.
type Quota struct {
	Limit     int
	Remaining int
	Reset     time.Time
}

type rateLimitResponse struct {
	RateLimits []struct {
		APIContext string `json:"apiContext"`
		APIName    string `json:"apiName"`
		Resources  []struct {
			Name  string `json:"name"`
			Rates []struct {
				Count     int    `json:"count"`
				Limit     int    `json:"limit"`
				Remaining int    `json:"remaining"`
				Reset     string `json:"reset"`
			} `json:"rates"`
		} `json:"resources"`
	} `json:"rateLimits"`
}

// browseResource is the allowance item_summary/search draws on.
const browseResource = "buy.browse"

// Quota reads the Browse allowance from eBay's Developer Analytics API. The
// read itself costs no Browse call.
func (c *Client) Quota(ctx context.Context) (Quota, error) {
	token, err := c.token(ctx)
	if err != nil {
		return Quota{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.baseURL+"/developer/analytics/v1_beta/rate_limit?api_name=browse&api_context=buy", nil)
	if err != nil {
		return Quota{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.http.Do(req)
	if err != nil {
		return Quota{}, fmt.Errorf("ebay rate limit: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Quota{}, fmt.Errorf("ebay rate limit: unexpected status %s", resp.Status)
	}

	var rl rateLimitResponse
	if err := json.UnmarshalRead(resp.Body, &rl); err != nil {
		return Quota{}, fmt.Errorf("ebay rate limit: decode: %w", err)
	}
	for _, l := range rl.RateLimits {
		for _, r := range l.Resources {
			if r.Name != browseResource || len(r.Rates) == 0 {
				continue
			}
			rate := r.Rates[0]
			q := Quota{Limit: rate.Limit, Remaining: rate.Remaining}
			if t, err := time.Parse(time.RFC3339, rate.Reset); err == nil {
				q.Reset = t
			}
			return q, nil
		}
	}
	return Quota{}, fmt.Errorf("ebay rate limit: no %s allowance in the response", browseResource)
}
