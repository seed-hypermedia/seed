import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import React from 'react'
import {Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native'
import {getCurrentServer} from '../store/server-store'
import {radius, shadowMd, theme} from '../theme'
import {Avatar} from './Avatar'

export type DocumentCardAuthor = {uid: string; name?: string; icon?: string | null}

/**
 * A document card with the same anatomy as the web's DocumentCard
 * (frontend/packages/ui/src/newspaper.tsx): thumbnail (cover / icon /
 * placeholder), title, summary, and a footer face pile. Used by query blocks
 * and embeds so both render identically.
 */
export function DocumentCard({
  id,
  metadata,
  firstImageInContent,
  summary,
  banner = false,
  commentCount = 0,
  authors = [],
  onPress,
  testID = 'document-card',
}: {
  id: UnpackedHypermediaId
  metadata?: HMMetadata | null
  /** Indexer-derived fallback cover (HMDocumentInfo.firstImageInContent). */
  firstImageInContent?: string
  /** Falls back to metadata.summary when omitted. */
  summary?: string
  banner?: boolean
  commentCount?: number
  authors?: DocumentCardAuthor[]
  onPress?: () => void
  testID?: string
}) {
  // Web cover resolution: explicit cover, else the indexer's first content
  // image — and an explicit icon suppresses the fallback entirely.
  const explicitCover = metadata?.cover
  const explicitIcon = metadata?.icon
  const coverImage = explicitCover || (explicitIcon ? undefined : firstImageInContent)
  const title = metadata?.name || id.path?.[id.path.length - 1] || id.uid
  const summaryText = summary ?? metadata?.summary
  const visibleAuthors = authors.slice(0, 3)
  const overflowAuthors = authors.length - visibleAuthors.length

  const body = (
    <View style={[styles.card, banner && styles.cardBanner]} testID={testID}>
      <Thumbnail coverImage={coverImage} icon={explicitIcon} id={id} title={title} />
      <View style={styles.textBlock}>
        <Text style={[styles.title, banner && styles.titleBanner]} numberOfLines={banner ? undefined : 2}>
          {title}
        </Text>
        {!!summaryText && (
          <Text style={[styles.summary, banner && styles.summaryBanner]} numberOfLines={2}>
            {summaryText}
          </Text>
        )}
      </View>
      {(visibleAuthors.length > 0 || commentCount > 0) && (
        <View style={styles.footer}>
          <View style={styles.facePile}>
            {visibleAuthors.map((author, index) => (
              <View key={author.uid} style={[styles.faceRing, index > 0 && styles.faceRingOverlap]}>
                <Avatar id={author.uid} name={author.name} icon={author.icon} size={20} />
              </View>
            ))}
            {overflowAuthors > 0 && (
              <View style={[styles.faceRing, styles.faceRingOverlap, styles.overflowChip]}>
                <Text style={styles.overflowText}>+{overflowAuthors}</Text>
              </View>
            )}
          </View>
          {commentCount > 0 && (
            <View style={styles.commentCount}>
              <Text style={styles.commentCountText}>💬 {commentCount}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  )

  if (!onPress) return body
  return (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} testID={`${testID}-press`}>
      {body}
    </TouchableOpacity>
  )
}

function Thumbnail({
  coverImage,
  icon,
  id,
  title,
}: {
  coverImage?: string
  icon?: string
  id: UnpackedHypermediaId
  title: string
}) {
  if (coverImage) {
    return <Image source={{uri: imageUrl(coverImage, 'L')}} style={styles.cover} resizeMode="cover" />
  }
  if (icon) {
    return (
      <View style={styles.iconBox}>
        <Image source={{uri: imageUrl(icon, 'S')}} style={styles.iconImage} resizeMode="cover" />
      </View>
    )
  }
  // Web's placeholder: emerald tile with a document glyph.
  return (
    <View style={[styles.iconBox, styles.placeholderBox]}>
      <Avatar id={id.id} name={title} size={32} />
    </View>
  )
}

function imageUrl(value: string, size: 'S' | 'L'): string {
  const cid = value.startsWith('ipfs://') ? value.slice('ipfs://'.length) : value
  return `${getCurrentServer().url}/hm/api/image/${cid}?size=${size}`
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadowMd,
  },
  cardBanner: {
    borderRadius: radius.xl,
  },
  cover: {
    margin: 12,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: theme.muted,
  },
  iconBox: {
    margin: 12,
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: theme.muted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iconImage: {
    width: 48,
    height: 48,
  },
  placeholderBox: {
    backgroundColor: theme.placeholderBg,
  },
  textBlock: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  title: {
    color: theme.foreground,
    fontSize: 18,
    lineHeight: 22.5,
    fontWeight: '700',
  },
  titleBanner: {
    fontSize: 24,
    lineHeight: 30,
  },
  summary: {
    color: theme.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  summaryBanner: {
    fontSize: 16,
    lineHeight: 24,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingLeft: 12,
    paddingRight: 8,
  },
  facePile: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  faceRing: {
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: theme.background,
    backgroundColor: theme.background,
  },
  faceRingOverlap: {
    marginLeft: -8,
  },
  overflowChip: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    color: '#9ca3af',
    fontSize: 10,
    fontWeight: '500',
  },
  commentCount: {
    paddingHorizontal: 6,
  },
  commentCountText: {
    color: theme.mutedForeground,
    fontSize: 12,
  },
})
