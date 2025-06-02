package blob

import (
	"crypto/sha256"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTSID_RoundTrip(t *testing.T) {
	ts := time.Now().UTC().Round(ClockPrecision)
	hash := [4]byte{0x12, 0x34, 0x56, 0x78}

	id := NewTSIDWithHash(ts, hash)

	extractedTS, extractedHash := id.Parse()
	require.Equal(t, ts, extractedTS.UTC())
	require.Equal(t, hash, extractedHash)
}

func TestTSID_Timestamp(t *testing.T) {
	ts := time.Date(2023, 10, 15, 14, 30, 45, 123*int(time.Millisecond), time.UTC)
	ts = ts.Round(ClockPrecision)
	hash := [4]byte{0xAB, 0xCD, 0xEF, 0x01}

	id := NewTSIDWithHash(ts, hash)

	extractedTS := id.Timestamp()
	require.Equal(t, ts, extractedTS.UTC())
}

func TestTSID_Bytes(t *testing.T) {
	ts := time.Now().UTC().Round(ClockPrecision)
	hash := [4]byte{0xFF, 0xEE, 0xDD, 0xCC}

	id := NewTSIDWithHash(ts, hash)

	bytes := id.Bytes()
	require.Len(t, bytes, 10)

	ms := decodeTime(bytes[:6])
	require.Equal(t, ts.UnixMilli(), ms)

	var extractedHash [4]byte
	copy(extractedHash[:], bytes[6:10])
	require.Equal(t, hash, extractedHash)
}

func TestTSID_MaxTimestamp(t *testing.T) {
	maxTimestamp := time.UnixMilli(maxTS - 1).UTC().Round(ClockPrecision)
	hash := [4]byte{0x11, 0x22, 0x33, 0x44}

	id := NewTSIDWithHash(maxTimestamp, hash)

	extractedTS := id.Timestamp()
	require.Equal(t, maxTimestamp, extractedTS.UTC())
}

func TestTSID_PanicOnExceedingMaxTimestamp(t *testing.T) {
	exceedingTimestamp := time.UnixMilli(maxTS).UTC()
	hash := [4]byte{0x11, 0x22, 0x33, 0x44}

	require.Panics(t, func() {
		NewTSIDWithHash(exceedingTimestamp, hash)
	})
}

func TestTSID_PanicOnNonRoundedTimestamp(t *testing.T) {
	ts := time.Now().UTC()
	ts = ts.Add(500 * time.Microsecond)
	hash := [4]byte{0x11, 0x22, 0x33, 0x44}

	require.Panics(t, func() {
		NewTSIDWithHash(ts, hash)
	})
}

func TestTSID_ZeroTimestamp(t *testing.T) {
	ts := time.Unix(0, 0).UTC().Round(ClockPrecision)
	hash := [4]byte{0x00, 0x00, 0x00, 0x00}

	id := NewTSIDWithHash(ts, hash)

	extractedTS := id.Timestamp()
	require.Equal(t, ts, extractedTS.UTC())

	parsedTS, parsedHash := id.Parse()
	require.Equal(t, ts, parsedTS.UTC())
	require.Equal(t, hash, parsedHash)
}

func TestTSID_DifferentHashes(t *testing.T) {
	ts := time.Now().UTC().Round(ClockPrecision)

	testCases := []struct {
		name string
		hash [4]byte
	}{
		{"zeros", [4]byte{0x00, 0x00, 0x00, 0x00}},
		{"max", [4]byte{0xFF, 0xFF, 0xFF, 0xFF}},
		{"mixed", [4]byte{0x12, 0x34, 0x56, 0x78}},
		{"reverse", [4]byte{0x87, 0x65, 0x43, 0x21}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			id := NewTSIDWithHash(ts, tc.hash)

			extractedTS, extractedHash := id.Parse()
			require.Equal(t, ts, extractedTS.UTC())
			require.Equal(t, tc.hash, extractedHash)
		})
	}
}

func TestTSID_Encoding(t *testing.T) {
	ts := time.Now().UTC().Round(ClockPrecision)
	hash := [4]byte{0x12, 0x34, 0x56, 0x78}

	id := NewTSIDWithHash(ts, hash)

	require.NotEmpty(t, string(id))
	require.True(t, len(string(id)) > 0)

	bytes := id.Bytes()
	require.Len(t, bytes, 10)
}

func TestTSID_Consistency(t *testing.T) {
	data := []byte("test data for hashing")
	hash := sha256.Sum256(data)
	truncatedHash := [4]byte{}
	copy(truncatedHash[:], hash[:4])

	ts := time.Now().UTC().Round(ClockPrecision)

	id1 := NewTSIDWithHash(ts, truncatedHash)
	id2 := NewTSIDWithHash(ts, truncatedHash)

	require.Equal(t, id1, id2)

	ts1, hash1 := id1.Parse()
	ts2, hash2 := id2.Parse()

	require.Equal(t, ts1.UTC(), ts2.UTC())
	require.Equal(t, hash1, hash2)
}

func TestTSID_UniqueForDifferentInputs(t *testing.T) {
	ts := time.Now().UTC().Round(ClockPrecision)
	hash1 := [4]byte{0x12, 0x34, 0x56, 0x78}
	hash2 := [4]byte{0x12, 0x34, 0x56, 0x79}

	id1 := NewTSIDWithHash(ts, hash1)
	id2 := NewTSIDWithHash(ts, hash2)

	require.NotEqual(t, id1, id2)

	ts2 := ts.Add(ClockPrecision)
	id3 := NewTSIDWithHash(ts2, hash1)

	require.NotEqual(t, id1, id3)
	require.NotEqual(t, id2, id3)
}

func TestTSID_TimeBoundaries(t *testing.T) {
	minTime := time.Unix(0, 0).UTC().Round(ClockPrecision)
	maxTime := time.UnixMilli(maxTS - 1).UTC().Round(ClockPrecision)
	hash := [4]byte{0x42, 0x42, 0x42, 0x42}

	idMin := NewTSIDWithHash(minTime, hash)
	idMax := NewTSIDWithHash(maxTime, hash)

	require.Equal(t, minTime, idMin.Timestamp().UTC())
	require.Equal(t, maxTime, idMax.Timestamp().UTC())

	tsMin, hashMin := idMin.Parse()
	tsMax, hashMax := idMax.Parse()

	require.Equal(t, minTime, tsMin.UTC())
	require.Equal(t, maxTime, tsMax.UTC())
	require.Equal(t, hash, hashMin)
	require.Equal(t, hash, hashMax)
}

func TestTSID_BytesPanicOnInvalidLength(t *testing.T) {
	require.Panics(t, func() {
		id := TSID("invalid")
		id.Bytes()
	})
}

func TestTSID_SequentialTimestamps(t *testing.T) {
	baseTime := time.Now().UTC().Round(ClockPrecision)
	hash := [4]byte{0x11, 0x22, 0x33, 0x44}

	var ids []TSID
	var times []time.Time

	for i := 0; i < 5; i++ {
		ts := baseTime.Add(time.Duration(i) * ClockPrecision)
		times = append(times, ts)
		ids = append(ids, NewTSIDWithHash(ts, hash))
	}

	for i, id := range ids {
		extractedTime := id.Timestamp().UTC()
		require.Equal(t, times[i], extractedTime)

		parsedTime, parsedHash := id.Parse()
		require.Equal(t, times[i], parsedTime.UTC())
		require.Equal(t, hash, parsedHash)
	}

	for i := 0; i < len(ids); i++ {
		for j := i + 1; j < len(ids); j++ {
			require.NotEqual(t, ids[i], ids[j])
		}
	}
}

func TestTSID_TimeEncodingDecoding(t *testing.T) {
	testTimes := []int64{
		0,
		1,
		1000,
		1234567890123,
		maxTS - 1,
	}

	for _, ms := range testTimes {
		t.Run(fmt.Sprintf("timestamp_%d", ms), func(t *testing.T) {
			b := make([]byte, 6)
			encodeTime(b, ms)
			decoded := decodeTime(b)
			require.Equal(t, ms, decoded)
		})
	}
}
