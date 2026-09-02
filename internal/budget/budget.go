// Package budget caps how many upstream API calls one run may spend, so that
// a growing community catalog cannot silently exceed the free daily quota.
package budget

type Budget struct {
	limit int
	used  int
}

// New returns a budget of limit calls. A limit of zero means unlimited.
func New(limit int) *Budget { return &Budget{limit: limit} }

func (b *Budget) Allow(cost int) bool {
	if b.limit > 0 && b.used+cost > b.limit {
		return false
	}
	b.used += cost
	return true
}

func (b *Budget) Used() int { return b.used }

func (b *Budget) Remaining() int {
	if b.limit == 0 {
		return -1
	}
	return b.limit - b.used
}
