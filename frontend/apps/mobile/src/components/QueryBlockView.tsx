import type {
  HMAccountsMetadata,
  HMBlockQuery,
  HMDocumentInfo,
  HMQueryBlockPayload,
} from '@seed-hypermedia/client/hm-types'
import React, {useEffect, useState} from 'react'
import {ActivityIndicator, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {formattedDate} from '../utils/dates'
import {DocumentCard, type DocumentCardAuthor} from './DocumentCard'
import {openDocument} from './doc-navigation'

type QueryState =
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'loaded'; payload: HMQueryBlockPayload | null}

// Renders a hypermedia Query block: runs the configured query against the
// current server and shows the results, matching the web's QueryBlockContent
// (Card grid with optional banner, List rows; Table falls back to List).
export function QueryBlockView({block}: {block: HMBlockQuery}) {
  const [state, setState] = useState<QueryState>({status: 'loading'})
  const query = block.attributes.query

  useEffect(() => {
    let cancelled = false
    setState({status: 'loading'})
    getSeedClient()
      .request('QueryBlock', {query})
      .then((payload) => {
        if (!cancelled) setState({status: 'loaded', payload})
      })
      .catch((err) => {
        console.error('Query block failed:', err)
        if (!cancelled) {
          setState({status: 'error', message: err instanceof Error ? err.message : 'Query failed'})
        }
      })
    return () => {
      cancelled = true
    }
    // The query is part of the immutable block revision
  }, [JSON.stringify(query)])

  if (state.status === 'loading') {
    return (
      <View style={styles.placeholder} testID="query-block-loading">
        <ActivityIndicator size="small" color="#4a9a9a" />
      </View>
    )
  }
  if (state.status === 'error') {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.errorText}>Failed to load query: {state.message}</Text>
      </View>
    )
  }
  const payload = state.payload
  if (!payload || payload.results.length === 0) {
    return (
      <View style={styles.placeholder} testID="query-block-empty">
        <Text style={styles.emptyText}>No documents found.</Text>
      </View>
    )
  }

  const style = block.attributes.style ?? 'Card'
  if (style === 'Card') {
    return (
      <CardGrid
        items={payload.results}
        banner={block.attributes.banner ?? false}
        columnCount={block.attributes.columnCount ?? 3}
        accountsMetadata={payload.accountsMetadata}
        interactionSummaries={payload.interactionSummaries}
      />
    )
  }
  // 'List', and 'Table' (no native table yet - the web table degrades to rows)
  return (
    <View style={styles.listContainer} testID="query-block-list">
      {payload.results.map((item) => (
        <ListRow
          key={item.id.id}
          item={item}
          accountsMetadata={payload.accountsMetadata}
          commentCount={payload.interactionSummaries[item.id.id]?.comments ?? 0}
        />
      ))}
    </View>
  )
}

function CardGrid({
  items,
  banner,
  columnCount,
  accountsMetadata,
  interactionSummaries,
}: {
  items: HMDocumentInfo[]
  banner: boolean
  columnCount: number
  accountsMetadata: HMAccountsMetadata
  interactionSummaries: HMQueryBlockPayload['interactionSummaries']
}) {
  const {width} = useWindowDimensions()
  // Mirror the web breakpoints: 1 column on phones, 2 from sm (640), the
  // configured count from md (768)
  const columns = width >= 768 ? Math.max(1, columnCount) : width >= 640 ? Math.min(2, columnCount) : 1

  const firstItem = banner ? items[0] : undefined
  const restItems = banner ? items.slice(1) : items

  return (
    <View style={styles.cardGridContainer} testID="query-block-cards">
      {firstItem && (
        <QueryResultCard
          item={firstItem}
          banner
          accountsMetadata={accountsMetadata}
          commentCount={interactionSummaries[firstItem.id.id]?.comments ?? 0}
        />
      )}
      <View style={styles.cardGrid}>
        {restItems.map((item) => (
          <View key={item.id.id} style={{width: `${100 / columns}%`, padding: 6}}>
            <QueryResultCard
              item={item}
              accountsMetadata={accountsMetadata}
              commentCount={interactionSummaries[item.id.id]?.comments ?? 0}
            />
          </View>
        ))}
      </View>
    </View>
  )
}

function getAuthors(item: HMDocumentInfo, accountsMetadata: HMAccountsMetadata): DocumentCardAuthor[] {
  return Array.from(new Set(item.authors))
    .slice(0, 3)
    .map((uid) => ({
      uid,
      name: accountsMetadata[uid]?.metadata?.name,
      icon: accountsMetadata[uid]?.metadata?.icon,
    }))
}

function QueryResultCard({
  item,
  banner = false,
  accountsMetadata,
  commentCount,
}: {
  item: HMDocumentInfo
  banner?: boolean
  accountsMetadata: HMAccountsMetadata
  commentCount: number
}) {
  return (
    <DocumentCard
      testID="query-block-card"
      id={item.id}
      metadata={item.metadata}
      firstImageInContent={item.firstImageInContent}
      banner={banner}
      commentCount={commentCount}
      authors={getAuthors(item, accountsMetadata)}
      onPress={() => openDocument(item.id, item.metadata?.name)}
    />
  )
}

function ListRow({
  item,
  accountsMetadata,
  commentCount,
}: {
  item: HMDocumentInfo
  accountsMetadata: HMAccountsMetadata
  commentCount: number
}) {
  const title = item.metadata?.name || item.path[item.path.length - 1] || item.id.uid
  const authorNames = getAuthors(item, accountsMetadata)
    .map((author) => author.name)
    .filter(Boolean)
    .join(', ')
  return (
    <TouchableOpacity
      testID="query-block-list-item"
      style={styles.listRow}
      onPress={() => openDocument(item.id, title)}
    >
      <Text style={styles.listTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.cardFooter}>
        {!!authorNames && (
          <Text style={styles.cardMeta} numberOfLines={1}>
            {authorNames}
          </Text>
        )}
        <Text style={styles.cardMeta}>{formattedDate(item.updateTime)}</Text>
        {commentCount > 0 && <Text style={styles.cardMeta}>💬 {commentCount}</Text>}
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#2a4a4a',
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
    alignItems: 'center',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
  },
  emptyText: {
    color: '#888',
    fontSize: 13,
    fontStyle: 'italic',
  },
  cardGridContainer: {
    marginBottom: 10,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -6,
    marginTop: 6,
  },
  card: {
    backgroundColor: '#2a4a4a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#3a5a5a',
  },
  cardBanner: {
    marginBottom: 6,
  },
  cardCover: {
    width: '100%',
    height: 120,
    backgroundColor: '#16302f',
  },
  cardCoverBanner: {
    height: 180,
  },
  cardBody: {
    padding: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  cardTitleBanner: {
    fontSize: 22,
  },
  cardSummary: {
    fontSize: 13,
    color: '#aaa',
    marginTop: 4,
    lineHeight: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  cardMeta: {
    fontSize: 12,
    color: '#7fa5a5',
  },
  listContainer: {
    marginBottom: 10,
    gap: 6,
  },
  listRow: {
    backgroundColor: '#2a4a4a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#3a5a5a',
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
})
