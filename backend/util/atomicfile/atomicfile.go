// This code is borrowed from https://github.com/tailscale/tailscale.

// Package atomicfile contains code related to writing to filesystems
// atomically.
//
// This package should be considered internal; its API is not stable.
package atomicfile

import (
	"io/ioutil"
	"os"
	"path/filepath"
	"runtime"
)

// WriteFile writes data to filename+some suffix, then renames it
// into filename.
func WriteFile(filename string, data []byte, perm os.FileMode) (err error) {
	f, err := ioutil.TempFile(filepath.Dir(filename), filepath.Base(filename)+".tmp")
	if err != nil {
		return err
	}
	tmpName := f.Name()
	defer func() {
		if err != nil {
			f.Close()
			os.Remove(tmpName)
		}
	}()
	if _, err := f.Write(data); err != nil {
		return err
	}
	if runtime.GOOS != "windows" {
		if err := f.Chmod(perm); err != nil {
			return err
		}
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, filename)
}
