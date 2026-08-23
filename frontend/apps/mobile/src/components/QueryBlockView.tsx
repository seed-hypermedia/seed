import type {
  HMAccountsMetadata,
  HMBlockQuery,
  HMDocumentInfo,
  HMQueryBlockPayload,
} from '@seed-hypermedia/client/hm-types'
import React, {useEffect, useState} from 'react'
import {ActivityIndicator, Image, StyleSheet, Text, useWindowDimensions, View} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {getCurrentServer} from '../store/server-store'
import {formattedDate} from '../utils/dates'

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
        <DocumentCard
          item={firstItem}
          banner
          accountsMetadata={accountsMetadata}
          commentCount={interactionSummaries[firstItem.id.id]?.comments ?? 0}
        />
      )}
      <View style={styles.cardGrid}>
        {restItems.map((item) => (
          <View key={item.id.id} style={{width: `${100 / columns}%`, padding: 6}}>
            <DocumentCard
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

// Cover resolution matches the web DocumentCard: explicit cover wins, the
// indexer-derived first content image is the fallback, and an icon suppresses
// the fallback entirely.
function getCoverUrl(item: HMDocumentInfo): string | null {
  const cover = item.metadata?.cover || (item.metadata?.icon ? undefined : item.firstImageInContent)
  if (!cover) return null
  const cid = cover.startsWith('ipfs://') ? cover.slice('ipfs://'.length) : cover
  return `${getCurrentServer().url}/hm/api/image/${cid}?size=M`
}

function getAuthorNames(item: HMDocumentInfo, accountsMetadata: HMAccountsMetadata): string {
  const names = Array.from(new Set(item.authors))
    .slice(0, 3)
    .map((uid) => accountsMetadata[uid]?.metadata?.name)
    .filter((name): name is string => !!name)
  return names.join(', ')
}

function DocumentCard({
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
  const coverUrl = getCoverUrl(item)
  const title = item.metadata?.name || item.path[item.path.length - 1] || item.id.uid
  const summary = item.metadata?.summary
  const authorNames = getAuthorNames(item, accountsMetadata)
  const date = formattedDate(item.updateTime)

  return (
    <View style={[styles.card, banner && styles.cardBanner]} testID="query-block-card">
      {coverUrl && (
        <Image
          source={{uri: coverUrl}}
          style={[styles.cardCover, banner && styles.cardCoverBanner]}
          resizeMode="cover"
        />
      )}
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, banner && styles.cardTitleBanner]} numberOfLines={banner ? 3 : 2}>
          {title}
        </Text>
        {!!summary && (
          <Text style={styles.cardSummary} numberOfLines={banner ? 4 : 2}>
            {summary}
          </Text>
        )}
        <View style={styles.cardFooter}>
          {!!authorNames && (
            <Text style={styles.cardMeta} numberOfLines={1}>
              {authorNames}
            </Text>
          )}
          {!!date && <Text style={styles.cardMeta}>{date}</Text>}
          {commentCount > 0 && <Text style={styles.cardMeta}>💬 {commentCount}</Text>}
        </View>
      </View>
    </View>
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
  const authorNames = getAuthorNames(item, accountsMetadata)
  const date = formattedDate(item.updateTime)
  return (
    <View style={styles.listRow} testID="query-block-list-item">
      <Text style={styles.listTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.cardFooter}>
        {!!authorNames && (
          <Text style={styles.cardMeta} numberOfLines={1}>
            {authorNames}
          </Text>
        )}
        {!!date && <Text style={styles.cardMeta}>{date}</Text>}
        {commentCount > 0 && <Text style={styles.cardMeta}>💬 {commentCount}</Text>}
      </View>
    </View>
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
