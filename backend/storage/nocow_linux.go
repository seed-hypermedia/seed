package storage

import (
	"go.uber.org/zap"
	"golang.org/x/sys/unix"
)

// fsNoCOWFlag is FS_NOCOW_FL from linux/fs.h, missing from x/sys/unix.
const fsNoCOWFlag = 0x00800000

// maybeDisableCOW sets the btrfs no-copy-on-write attribute on dir, so that
// files created inside it inherit it. SQLite's random page writes fragment a
// CoW filesystem quickly and stall WAL commits and checkpoint fsyncs during
// bulk writes (observed: an 88-second COMMIT during cold sync on btrfs, with
// thousands of extents after a single day). SQLite detects its own corruption,
// so it loses nothing from opting out of btrfs checksumming.
//
// Only files created after the flag is set inherit it, so this must run before
// the database files exist to take full effect. On an existing data directory
// it silently covers files created from then on.
//
// Best-effort: any failure is logged and ignored.
func maybeDisableCOW(dir string, log *zap.Logger) {
	var st unix.Statfs_t
	if err := unix.Statfs(dir, &st); err != nil || uint32(st.Type) != uint32(unix.BTRFS_SUPER_MAGIC) {
		return
	}

	fd, err := unix.Open(dir, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		log.Warn("BtrfsDisableCOWFailed", zap.String("dir", dir), zap.Error(err))
		return
	}
	defer unix.Close(fd)

	attrs, err := unix.IoctlGetInt(fd, unix.FS_IOC_GETFLAGS)
	if err != nil {
		log.Warn("BtrfsDisableCOWFailed", zap.String("dir", dir), zap.Error(err))
		return
	}

	if attrs&fsNoCOWFlag != 0 {
		return
	}

	if err := unix.IoctlSetPointerInt(fd, unix.FS_IOC_SETFLAGS, attrs|fsNoCOWFlag); err != nil {
		log.Warn("BtrfsDisableCOWFailed", zap.String("dir", dir), zap.Error(err))
		return
	}

	log.Info("BtrfsCOWDisabled", zap.String("dir", dir))
}
