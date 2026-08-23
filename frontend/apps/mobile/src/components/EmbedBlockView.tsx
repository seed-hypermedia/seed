import {unpackHmId, type HMMetadata, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import React, {useEffect, useState} from 'react'
import {StyleSheet, Text, View} from 'react-native'
import {radius, theme} from '../theme'
import {getSeedClient} from '../client/seed-client'
import {DocumentCard} from './DocumentCard'
import {openDocument} from './doc-navigation'

type EmbedState =
  | {status: 'loading'}
  | {status: 'error'}
  | {status: 'loaded'; metadata: HMMetadata | null; id: UnpackedHypermediaId}

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
        const loaded: EmbedState = {status: 'loaded', metadata: payload.metadata ?? null, id: target}
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
    return <View testID="embed-card-loading" style={styles.placeholder} />
  }
  if (state.status === 'error') {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.errorText}>Document not available</Text>
      </View>
    )
  }
  return (
    <View style={styles.cardWrap}>
      <DocumentCard
        testID="embed-card"
        id={state.id}
        metadata={state.metadata}
        onPress={() => openDocument(state.id, state.metadata?.name)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  cardWrap: {
    marginBottom: 10,
  },
  placeholder: {
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.lg,
    padding: 12,
    marginBottom: 10,
  },
  errorText: {
    color: theme.mutedForeground,
    fontSize: 13,
    fontStyle: 'italic',
  },
})
