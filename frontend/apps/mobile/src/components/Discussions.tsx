import type {HMComment, HMCommentGroup, HMMetadataPayload, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import React, {useEffect, useState} from 'react'
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {radius, theme} from '../theme'
import {formattedDateShort} from '../utils/dates'
import {Avatar} from './Avatar'
import {BlockNodeView} from './BlockNodeView'

type DiscussionsState =
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'loaded'; groups: HMCommentGroup[]; authors: Record<string, HMMetadataPayload>}

/**
 * The Discussions list for a document — the web's Discussions component
 * (frontend/packages/ui/src/comments.tsx): comment groups (linear threads)
 * with author, short timestamp, and the comment's block content.
 */
export function Discussions({targetId}: {targetId: UnpackedHypermediaId}) {
  const [state, setState] = useState<DiscussionsState>({status: 'loading'})

  useEffect(() => {
    let cancelled = false
    setState({status: 'loading'})
    getSeedClient()
      .request('ListDiscussions', {targetId})
      .then((payload) => {
        if (cancelled) return
        setState({status: 'loaded', groups: payload.discussions ?? [], authors: payload.authors ?? {}})
      })
      .catch((error) => {
        if (cancelled) return
        setState({status: 'error', message: error instanceof Error ? error.message : String(error)})
      })
    return () => {
      cancelled = true
    }
  }, [targetId.id])

  if (state.status === 'loading') {
    return <ActivityIndicator color={theme.brand} style={styles.loader} testID="discussions-loading" />
  }
  if (state.status === 'error') {
    return (
      <Text testID="discussions-error" style={styles.errorText}>
        Failed to load discussions: {state.message}
      </Text>
    )
  }
  if (state.groups.length === 0) {
    return (
      <View style={styles.empty} testID="discussions-empty">
        <Text style={styles.emptyGlyph}>💬</Text>
        <Text style={styles.emptyText}>No comments here, yet!</Text>
      </View>
    )
  }
  return (
    <View testID="discussions-list">
      {state.groups.map((group) => (
        <View key={group.id} style={styles.group} testID="discussion-group">
          {group.comments.map((comment) => (
            <CommentRow key={comment.id} comment={comment} authors={state.authors} />
          ))}
          {group.moreCommentsCount > 0 && (
            <Text style={styles.moreReplies}>
              {group.moreCommentsCount} more {group.moreCommentsCount === 1 ? 'reply' : 'replies'}
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}

function CommentRow({comment, authors}: {comment: HMComment; authors: Record<string, HMMetadataPayload>}) {
  const author = authors[comment.author]?.metadata
  const authorName = author?.name || `?${comment.author.slice(-8)}`
  return (
    <View style={styles.commentRow} testID="discussion-comment">
      <Avatar id={comment.author} name={author?.name} icon={author?.icon} size={20} />
      <View style={styles.commentBody}>
        <Text style={styles.commentHeader}>
          <Text style={styles.authorName}>{authorName}</Text>
          <Text style={styles.commentDate}> {formattedDateShort(comment.createTime)}</Text>
        </Text>
        {comment.content.map((node, index) => (
          <BlockNodeView key={node.block?.id ?? index} node={node} />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  loader: {
    marginTop: 24,
  },
  errorText: {
    color: theme.mutedForeground,
    fontSize: 14,
    marginTop: 16,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 16,
  },
  emptyGlyph: {
    fontSize: 40,
    opacity: 0.35,
  },
  emptyText: {
    color: theme.mutedForeground,
    fontSize: 16,
  },
  group: {
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    paddingVertical: 8,
    gap: 8,
  },
  commentRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    borderRadius: radius.lg,
  },
  commentBody: {
    flex: 1,
    gap: 4,
  },
  commentHeader: {
    color: theme.mutedForeground,
    fontSize: 14,
  },
  authorName: {
    color: theme.foreground,
    fontSize: 14,
    fontWeight: '700',
  },
  commentDate: {
    color: theme.mutedForeground,
    fontSize: 11,
  },
  moreReplies: {
    color: theme.mutedForeground,
    fontSize: 12,
    paddingLeft: 36,
    paddingBottom: 4,
  },
})
