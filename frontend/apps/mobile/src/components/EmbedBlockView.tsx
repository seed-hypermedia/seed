import {unpackHmId, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import React, {useEffect, useState} from 'react'
import {StyleSheet, Text, View} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {Avatar} from './Avatar'

type EmbedState =
  | {status: 'loading'}
  | {status: 'error'}
  | {status: 'loaded'; name: string; icon?: string | null; id: UnpackedHypermediaId}

// Metadata cache keyed by the embed link — home pages routinely carry dozens
// of embeds and remounting must not refetch them all.
const embedCache = new Map<string, EmbedState>()

/**
 * Renders an Embed block as a document card (the web's view="Card"
 * treatment). Other embed views also render as cards for now — inline
 * content embeds are a follow-up.
 */
export function EmbedBlockView({link}: {link: string}) {
  const [state, setState] = useState<EmbedState>(() => embedCache.get(link) ?? {status: 'loading'})

  useEffect(() => {
    const cached = embedCache.get(link)
    if (cached && cached.status !== 'error') {
      setState(cached)
      return
    }
    let cancelled = false
    const target = unpackHmId(link)
    if (!target) {
      const errorState: EmbedState = {status: 'error'}
      embedCache.set(link, errorState)
      setState(errorState)
      return
    }
    getSeedClient()
      .request('ResourceMetadata', target)
      .then((payload) => {
        const name = payload.metadata?.name?.trim() || target.path?.[target.path.length - 1] || target.uid.slice(0, 12)
        const loaded: EmbedState = {status: 'loaded', name, icon: payload.metadata?.icon, id: target}
        embedCache.set(link, loaded)
        if (!cancelled) setState(loaded)
      })
      .catch(() => {
        // Do not cache errors permanently — the doc may sync in later.
        if (!cancelled) setState({status: 'error'})
      })
    return () => {
      cancelled = true
    }
  }, [link])

  if (state.status === 'loading') {
    return <View testID="embed-card-loading" style={[styles.card, styles.placeholder]} />
  }
  if (state.status === 'error') {
    return (
      <View style={[styles.card, styles.placeholder]}>
        <Text style={styles.errorText}>Document not available</Text>
      </View>
    )
  }
  return (
    <View testID="embed-card" style={styles.card}>
      <Avatar id={state.id.id} name={state.name} icon={state.icon} size={28} />
      <View style={styles.cardText}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {state.name}
        </Text>
        {!!state.id.path?.length && (
          <Text style={styles.cardPath} numberOfLines={1}>
            /{state.id.path.join('/')}
          </Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a4a4a',
    borderWidth: 1,
    borderColor: '#3a5a5a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  placeholder: {
    minHeight: 54,
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    marginLeft: 10,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  cardPath: {
    color: '#7fa5a5',
    fontSize: 12,
    marginTop: 2,
  },
  errorText: {
    color: '#888',
    fontSize: 13,
    fontStyle: 'italic',
  },
})
