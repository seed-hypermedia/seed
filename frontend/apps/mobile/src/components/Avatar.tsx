import React from 'react'
import {Image, StyleSheet, Text, View} from 'react-native'
import {getCurrentServer} from '../store/server-store'

// Desktop renders jdenticon identicons (green hue 151) when there is no icon.
// Mobile approximates with a deterministic green-family disc + initial so an
// account keeps a stable look; a shared identicon can replace this later.
function hueFor(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  // Green family around desktop's hue 151, ±24 per account
  return 151 + (Math.abs(hash) % 49) - 24
}

export function iconUrl(icon: string | undefined | null, size: 'S' | 'M' = 'S'): string | null {
  if (!icon) return null
  const cid = icon.startsWith('ipfs://') ? icon.slice('ipfs://'.length) : icon
  return `${getCurrentServer().url}/hm/api/image/${cid}?size=${size}`
}

export function Avatar({
  id,
  name,
  icon,
  size = 32,
}: {
  /** Stable seed — the account id. */
  id: string
  name?: string
  /** ipfs:// icon url from document metadata, when published. */
  icon?: string | null
  size?: number
}) {
  const url = iconUrl(icon)
  const initial = (name?.trim()?.[0] ?? id[0] ?? '?').toUpperCase()
  return (
    <View
      style={[
        styles.container,
        {width: size, height: size, borderRadius: size / 2},
        !url && {backgroundColor: `hsl(${hueFor(id)}, 54%, 42%)`},
      ]}
    >
      {url ? (
        <Image source={{uri: url}} style={{width: size, height: size}} resizeMode="cover" />
      ) : (
        <Text style={[styles.initial, {fontSize: size * 0.5}]}>{initial}</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    color: '#fff',
    fontWeight: '700',
  },
})
