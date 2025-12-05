package unsafeutil

import "unsafe"

// StringFromBytes unsafely converts a byte slice to a string.
func StringFromBytes[T ~[]byte](b T) string {
	if len(b) == 0 {
		return ""
	}

	return unsafe.String(&b[0], len(b))
}

// BytesFromString unsafely converts a string to a byte slice.
func BytesFromString[T ~string](s T) []byte {
	if len(s) == 0 {
		return nil
	}

	return unsafe.Slice(unsafe.StringData(string(s)), len(s))
}
