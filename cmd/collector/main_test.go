package main

import "testing"

func TestPlanCallsFitsTheRunIntoTheQuotaLeft(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name                   string
		limit, remaining, need int
		wantAllowed            int
		wantProceed            bool
	}{
		{"plenty left", 2000, 5000, 1068, 2000, true},
		{"unlimited budget is capped at the quota", 0, 3000, 1068, 3000, true},
		{"less left than the budget caps the run", 2000, 900, 1068, 900, true},
		// 427 calls cannot price half of 1,068 games: the 8 October run spent
		// them, failed the health check and committed nothing.
		{"too little for a healthy run", 2000, 427, 1068, 0, false},
		{"nothing left", 2000, 0, 1068, 0, false},
		{"exactly half is healthy", 2000, 534, 1068, 534, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			allowed, proceed := planCalls(c.limit, c.remaining, c.need)
			if allowed != c.wantAllowed || proceed != c.wantProceed {
				t.Errorf("planCalls(%d, %d, %d) = %d, %v; want %d, %v",
					c.limit, c.remaining, c.need, allowed, proceed, c.wantAllowed, c.wantProceed)
			}
		})
	}
}
