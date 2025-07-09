// Package debugx provides simple debugging facilities.
// It's not named debug to avoid name clash with the stdlib debug package.
// It's a separate package to allow easily grep-ing for debug statements in the codebase.
package debugx

import (
	"fmt"
	"sync"

	"github.com/sanity-io/litter"
)

var dumpCfg = litter.Config

// Re-exporting common debugging functions from other packages.
var (
	Print   = fmt.Print
	Println = fmt.Println
	Printf  = fmt.Printf
	Dump    = dumpCfg.Dump
)

// DumpAll dumps all the values to stdout with private fields.
func DumpAll(vv ...any) {
	cfg := dumpCfg
	cfg.HidePrivateFields = true
	cfg.Dump(vv...)
}

var vars = sync.Map{}

// SetVar is like a named breakpoint for print debugging.
// You'd add a named flag some place in the code after which you want to do some printing,
// and then you'd check if that flag is set in the code where you want to print.
// It's basically a thread-safe global variable, scoped to this debugging package for convenience.
func SetVar[T any](name string, v T) {
	vars.Store(name, v)
}

// GetVar returns the value of a named flag.
// If the flag is not set, it returns the zero value of the type and false.
func GetVar[T any](name string) (T, bool) {
	val, ok := vars.Load(name)
	return val.(T), ok
}

// CheckVar checks if a named flag is set.
func CheckVar(name string) bool {
	_, ok := vars.Load(name)
	return ok
}

// UnsetVar unsets a named flag.
func UnsetVar(name string) {
	vars.Delete(name)
}
