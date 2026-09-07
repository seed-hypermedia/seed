import {BlockList, isIP} from 'net'

const blockedIPv4Addresses = new BlockList()
const blockedIPv6Addresses = new BlockList()
const allowedIPv6Addresses = new BlockList()
allowedIPv6Addresses.addSubnet('2000::', 3, 'ipv6')

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedIPv4Addresses.addSubnet(address, prefix, 'ipv4')
}

for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['100:0:0:1::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedIPv6Addresses.addSubnet(address, prefix, 'ipv6')
}

export function normalizeIPHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

export function isPublicIPAddress(address: string): boolean {
  const normalized = normalizeIPHostname(address)
  const family = isIP(normalized)
  if (family === 4) return !blockedIPv4Addresses.check(normalized, 'ipv4')
  if (family === 6) {
    return allowedIPv6Addresses.check(normalized, 'ipv6') && !blockedIPv6Addresses.check(normalized, 'ipv6')
  }
  return false
}
