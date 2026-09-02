package budget_test

import (
	"testing"

	"github.com/rflpazini/retroheat/internal/budget"
)

func TestAllowSpendsUntilExhausted(t *testing.T) {
	t.Parallel()
	b := budget.New(3)
	for i := range 3 {
		if !b.Allow(1) {
			t.Fatalf("call %d denied while budget remained", i)
		}
	}
	if b.Allow(1) {
		t.Error("Allow granted a call past the limit")
	}
	if b.Used() != 3 {
		t.Errorf("Used = %d, want 3", b.Used())
	}
}

func TestAllowRejectsCostLargerThanRemaining(t *testing.T) {
	t.Parallel()
	b := budget.New(5)
	if !b.Allow(4) {
		t.Fatal("first call denied")
	}
	if b.Allow(4) {
		t.Error("Allow granted a 4-call request with 1 remaining")
	}
	if b.Used() != 4 {
		t.Errorf("Used = %d, want 4 (a denied request must not be charged)", b.Used())
	}
}

func TestZeroLimitMeansUnlimited(t *testing.T) {
	t.Parallel()
	b := budget.New(0)
	for range 1000 {
		if !b.Allow(1) {
			t.Fatal("unlimited budget denied a call")
		}
	}
}
