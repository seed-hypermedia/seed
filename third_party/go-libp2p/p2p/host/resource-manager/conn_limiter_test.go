package rcmgr

import (
	"encoding/binary"
	"net"
	"net/netip"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestItLimits(t *testing.T) {
	t.Run("IPv4", func(t *testing.T) {
		ip, err := netip.ParseAddr("1.2.3.4")
		require.NoError(t, err)
		cl := newConnLimiter()
		cl.connLimitPerSubnetV4[0].ConnCount = 1
		require.True(t, cl.addConn(ip))

		// should fail the second time
		require.False(t, cl.addConn(ip))

		otherIP, err := netip.ParseAddr("1.2.3.5")
		require.NoError(t, err)
		require.True(t, cl.addConn(otherIP))
	})
	t.Run("IPv6", func(t *testing.T) {
		ip, err := netip.ParseAddr("1:2:3:4::1")
		require.NoError(t, err)
		cl := newConnLimiter()
		original := cl.connLimitPerSubnetV6[0].ConnCount
		cl.connLimitPerSubnetV6[0].ConnCount = 1
		defer func() {
			cl.connLimitPerSubnetV6[0].ConnCount = original
		}()
		require.True(t, cl.addConn(ip))

		// should fail the second time
		require.False(t, cl.addConn(ip))
		otherIPSameSubnet := netip.MustParseAddr("1:2:3:4::2")
		require.False(t, cl.addConn(otherIPSameSubnet))

		otherIP := netip.MustParseAddr("2:2:3:4::2")
		require.True(t, cl.addConn(otherIP))
	})

	t.Run("IPv6 with multiple limits", func(t *testing.T) {
		cl := newConnLimiter()
		for i := 0; i < defaultMaxConcurrentConns; i++ {
			ip := net.ParseIP("ff:2:3:4::1")
			binary.BigEndian.PutUint16(ip[14:], uint16(i))
			ipAddr := netip.MustParseAddr(ip.String())
			require.True(t, cl.addConn(ipAddr))
		}

		// Next one should fail
		ip := net.ParseIP("ff:2:3:4::1")
		binary.BigEndian.PutUint16(ip[14:], uint16(defaultMaxConcurrentConns+1))
		require.False(t, cl.addConn(netip.MustParseAddr(ip.String())))

		// But on a different root subnet should work
		otherIP := netip.MustParseAddr("ffef:2:3::1")
		require.True(t, cl.addConn(otherIP))

		// But too many on the next subnet limit will fail too
		for i := 0; i < defaultMaxConcurrentConns*8; i++ {
			ip := net.ParseIP("ffef:2:3:4::1")
			binary.BigEndian.PutUint16(ip[5:7], uint16(i))
			ipAddr := netip.MustParseAddr(ip.String())
			require.True(t, cl.addConn(ipAddr))
		}

		ip = net.ParseIP("ffef:2:3:4::1")
		binary.BigEndian.PutUint16(ip[5:7], uint16(defaultMaxConcurrentConns*8+1))
		ipAddr := netip.MustParseAddr(ip.String())
		require.False(t, cl.addConn(ipAddr))
	})

	t.Run("IPv4 with localhost", func(t *testing.T) {
		cl := &connLimiter{
			networkPrefixLimitV4: DefaultNetworkPrefixLimitV4,
			connLimitPerSubnetV4: []ConnLimitPerSubnet{
				{PrefixLength: 0, ConnCount: 1}, // 1 connection for the whole IPv4 space
			},
		}

		ip := netip.MustParseAddr("1.2.3.4")
		require.True(t, cl.addConn(ip))

		ip = netip.MustParseAddr("4.3.2.1")
		// should fail the second time, we only allow 1 connection for the whole IPv4 space
		require.False(t, cl.addConn(ip))

		ip = netip.MustParseAddr("127.0.0.1")
		// Succeeds because we defined an explicit limit for the loopback subnet
		require.True(t, cl.addConn(ip))
	})
}

func genIP(data *[]byte) (netip.Addr, bool) {
	if len(*data) < 1 {
		return netip.Addr{}, false
	}

	genIP6 := (*data)[0]&0x01 == 1
	bytesRequired := 4
	if genIP6 {
		bytesRequired = 16
	}

	if len((*data)[1:]) < bytesRequired {
		return netip.Addr{}, false
	}

	*data = (*data)[1:]
	ip, ok := netip.AddrFromSlice((*data)[:bytesRequired])
	*data = (*data)[bytesRequired:]
	return ip, ok
}

func FuzzConnLimiter(f *testing.F) {
	// The goal is to try to enter a state where the count is incorrectly 0
	f.Fuzz(func(t *testing.T, data []byte) {
		ips := make([]netip.Addr, 0, len(data)/5)
		for {
			ip, ok := genIP(&data)
			if !ok {
				break
			}
			ips = append(ips, ip)
		}

		cl := newConnLimiter()
		addedConns := make([]netip.Addr, 0, len(ips))
		for _, ip := range ips {
			if cl.addConn(ip) {
				addedConns = append(addedConns, ip)
			}
		}

		addedCount := 0
		for _, ip := range cl.ip4connsPerLimit {
			for _, count := range ip {
				addedCount += count
			}
		}
		for _, ip := range cl.ip6connsPerLimit {
			for _, count := range ip {
				addedCount += count
			}
		}
		for _, count := range cl.connsPerNetworkPrefixV4 {
			addedCount += count
		}
		for _, count := range cl.connsPerNetworkPrefixV6 {
			addedCount += count
		}
		if addedCount == 0 && len(addedConns) > 0 {
			t.Fatalf("added count: %d", addedCount)
		}

		for _, ip := range addedConns {
			cl.rmConn(ip)
		}

		leftoverCount := 0
		for _, ip := range cl.ip4connsPerLimit {
			for _, count := range ip {
				leftoverCount += count
			}
		}
		for _, ip := range cl.ip6connsPerLimit {
			for _, count := range ip {
				leftoverCount += count
			}
		}
		for _, count := range cl.connsPerNetworkPrefixV4 {
			addedCount += count
		}
		for _, count := range cl.connsPerNetworkPrefixV6 {
			addedCount += count
		}
		if leftoverCount != 0 {
			t.Fatalf("leftover count: %d", leftoverCount)
		}
	})
}

func TestSortedNetworkPrefixLimits(t *testing.T) {
	npLimits := []NetworkPrefixLimit{
		{
			Network: netip.MustParsePrefix("1.2.0.0/16"),
		},
		{
			Network: netip.MustParsePrefix("1.2.3.0/28"),
		},
		{
			Network: netip.MustParsePrefix("1.2.3.4/32"),
		},
	}
	npLimits = sortNetworkPrefixes(npLimits)
	sorted := []NetworkPrefixLimit{
		{
			Network: netip.MustParsePrefix("1.2.3.4/32"),
		},
		{
			Network: netip.MustParsePrefix("1.2.3.0/28"),
		},
		{
			Network: netip.MustParsePrefix("1.2.0.0/16"),
		},
	}
	require.EqualValues(t, sorted, npLimits)
}
