package catalog

import (
	"fmt"
	"slices"
)

// Barcode is one code printed on a box of the game, so a phone can find the
// entry by scanning it. A game can carry several: the first print and its
// reprints have codes of their own. Variant names the edition the code was
// printed on when it is not the entry's own; empty means the entry itself.
type Barcode struct {
	Code    string  `yaml:"code" json:"code"`
	Variant Variant `yaml:"variant,omitempty" json:"variant,omitempty"`
}

// NormalizeGTIN turns a code as printed into the 13-digit form every lookup
// uses: a 12-digit UPC-A reads as an EAN-13 with a leading zero, which is how
// eBay and most scanners report it. It refuses anything else, including a
// code whose check digit does not add up, since a misread digit would point
// at some other product.
func NormalizeGTIN(code string) (string, bool) {
	for _, r := range code {
		if r < '0' || r > '9' {
			return "", false
		}
	}
	switch len(code) {
	case 12:
		code = "0" + code
	case 13:
	default:
		return "", false
	}
	if !checkDigitOK(code) {
		return "", false
	}
	return code, true
}

// checkDigitOK applies the GS1 mod-10 rule: from the right, digits before the
// check digit weigh 3, 1, 3, 1…, and the check digit tops the sum up to a
// multiple of ten.
func checkDigitOK(code string) bool {
	sum := 0
	for i := len(code) - 2; i >= 0; i-- {
		d := int(code[i] - '0')
		if (len(code)-2-i)%2 == 0 {
			d *= 3
		}
		sum += d
	}
	return (10-sum%10)%10 == int(code[len(code)-1]-'0')
}

// validateBarcodes checks one entry's codes and records them in owner, so a
// code claimed by two entries is caught: a scan has to land on one game.
func validateBarcodes(g Game, owner map[string]string) []error {
	var errs []error
	for _, b := range g.Barcodes {
		code, ok := NormalizeGTIN(b.Code)
		if !ok {
			errs = append(errs, fmt.Errorf("%s: barcode %q is not a 12- or 13-digit code with a valid check digit", g.ID, b.Code))
			continue
		}
		if b.Variant != "" && !slices.Contains(variants, b.Variant) {
			errs = append(errs, fmt.Errorf("%s: barcode %s has unknown variant %q", g.ID, b.Code, b.Variant))
		}
		if prev, taken := owner[code]; taken {
			if prev == g.ID {
				errs = append(errs, fmt.Errorf("%s: barcode %s listed twice", g.ID, b.Code))
			} else {
				errs = append(errs, fmt.Errorf("%s: barcode %s already belongs to %s", g.ID, b.Code, prev))
			}
			continue
		}
		owner[code] = g.ID
	}
	return errs
}
