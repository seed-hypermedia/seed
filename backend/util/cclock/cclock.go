// Package cclock provides a causal clock.
// It ensure monotonicity of the timestamps.
package cclock

import (
	"fmt"
	"time"
)

const (
	DefaultPrecision     = time.Millisecond
	defaultSkewThreshold = time.Second * 40 // Quite arbitrary.
)

// Clock issues timestamps that are guaranteed to be greater than any previously observed timestamp,
// unless the local clock skew is greater than the configured threshold.
// Use New() to create clocks.
type Clock struct {
	maxTime       time.Time
	NowFunc       func() time.Time
	Precision     time.Duration
	SkewThreshold time.Duration
}

// New creates a new Clock with default configuration.
func New() *Clock {
	return &Clock{
		NowFunc:       time.Now,
		Precision:     DefaultPrecision,
		SkewThreshold: defaultSkewThreshold,
	}
}

// Track a timestamp observed elsewhere.
func (c *Clock) Track(t time.Time) error {
	t = t.Round(c.Precision)
	now := c.now()

	if t.Sub(now) >= c.SkewThreshold {
		return fmt.Errorf("tracked timestamp %s is way ahead of the local time %s", t, now)
	}

	c.track(t)
	return nil
}

func (c *Clock) track(t time.Time) {
	t = t.Round(c.Precision)
	if t.After(c.maxTime.Round(c.Precision)) {
		c.maxTime = t
	}
}

// Now creates a new timestamp for the current time,
// ensuring it's greater than any previously tracked timestamps.
func (c *Clock) Now() (time.Time, error) {
	now := c.now()

	// If local clock is less than max tracked timestamp, something is going wrong.
	diff := c.maxTime.Sub(now)
	if diff >= c.SkewThreshold {
		return time.Time{}, fmt.Errorf("local clock %s is way behind the maximum tracked timestamp %s", now, c.maxTime)
	}

	if diff >= 0 {
		now = now.Add(diff + 1*c.Precision).Round(c.Precision)
		if !c.maxTime.Before(now) {
			panic("BUG: can't generate a good timestamp after adjusting")
		}
	}

	c.track(now)
	return now, nil
}

// MustNow is like Now(), but panics in case of untolerable clock skew.
func (c *Clock) MustNow() time.Time {
	t, err := c.Now()
	if err != nil {
		panic(err)
	}
	return t
}

func (c *Clock) now() time.Time {
	return c.NowFunc().Round(c.Precision)
}
