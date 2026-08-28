import type {HMBlockNode, HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmIdPathToEntityQueryPath} from '@seed-hypermedia/client/hm-types'
import React, {useEffect, useState} from 'react'
import {StyleSheet, Text, View} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {extractContentRefIds, hasQueryBlockTargetingSelf} from '../utils/content-refs'
import {formattedDate} from '../utils/dates'

type LoadState = {status: 'loading'} | {status: 'hidden'} | {status: 'loaded'; docs: HMDocumentInfo[]}

/**
 * Child documents not referenced anywhere in the document content — the
 * web's UnreferencedDocuments section (frontend/packages/ui). Hidden when a
 * query block already lists the document's own children.
 */
export function UnreferencedChildren({uid, path, content}: {uid: string; path: string[]; content: HMBlockNode[]}) {
  const [state, setState] = useState<LoadState>({status: 'loading'})

  useEffect(() => {
    let cancelled = false
    if (hasQueryBlockTargetingSelf(content, uid, path)) {
      setState({status: 'hidden'})
      return
    }
    getSeedClient()
      .request('Query', {
        includes: [{space: uid, path: hmIdPathToEntityQueryPath(path), mode: 'Children'}],
      })
      .then((result) => {
        if (cancelled) return
        const referenced = extractContentRefIds(content)
        const docs = (result?.results ?? [])
          .filter((child) => child.visibility !== 'PRIVATE')
          .filter((child) => !referenced.has(child.id.id))
        setState(docs.length > 0 ? {status: 'loaded', docs} : {status: 'hidden'})
      })
      .catch(() => {
        // Directory unavailable — show nothing rather than an error banner.
        if (!cancelled) setState({status: 'hidden'})
      })
    return () => {
      cancelled = true
    }
  }, [uid, path.join('/'), content])

  if (state.status !== 'loaded') return null

  return (
    <View testID="unreferenced-children" style={styles.container}>
      {state.docs.map((doc) => (
        <View key={doc.id.id} testID="unreferenced-child" style={styles.row}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {doc.metadata?.name || doc.path[doc.path.length - 1] || doc.id.uid}
          </Text>
          <Text style={styles.rowMeta}>{formattedDate(doc.updateTime)}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#2a5555',
    paddingTop: 12,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#233f3f',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 10,
  },
  rowMeta: {
    color: '#557777',
    fontSize: 11,
  },
})
