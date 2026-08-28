import type {HMComment, HMCommentGroup, HMMetadataPayload, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import React, {useCallback, useEffect, useState} from 'react'
import {ActivityIndicator, StyleSheet, Text, TouchableOpacity, View} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {radius, theme} from '../theme'
import {formattedDateShort} from '../utils/dates'
import {Avatar} from './Avatar'
import {BlockNodeView} from './BlockNodeView'
import {CommentComposer} from './CommentComposer'

type DiscussionsState =
  | {status: 'loading'}
  | {status: 'error'; message: string}
  | {status: 'loaded'; groups: HMCommentGroup[]; authors: Record<string, HMMetadataPayload>}

/**
 * The Discussions list for a document — the web's Discussions component
 * (frontend/packages/ui/src/comments.tsx): comment groups (linear threads)
 * with author, short timestamp, and the comment's block content.
 *
 * Pass `commentId` to show a single thread instead of every discussion; in that
 * mode the composer posts replies into the thread rather than new discussions.
 */
export function Discussions({
  targetId,
  docVersion,
  commentId,
  onOpenComment,
  onPosted,
}: {
  targetId: UnpackedHypermediaId
  /** Version of the document being commented on; omit to hide the composer. */
  docVersion?: string
  /** Show only this comment's thread. */
  commentId?: string
  /** Called when a comment row is tapped (opens its thread). */
  onOpenComment?: (comment: HMComment) => void
  /** Called after a comment is published, for counters kept outside this list. */
  onPosted?: () => void
}) {
  const [state, setState] = useState<DiscussionsState>({status: 'loading'})
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({status: 'loading'})
    getSeedClient()
      .request('ListDiscussions', {targetId, ...(commentId ? {commentId} : {})})
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
  }, [targetId.id, commentId, reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  // In thread mode the reply lands under the thread's root comment.
  const threadRoot = commentId && state.status === 'loaded' ? state.groups[0]?.comments[0] : undefined

  const composer = docVersion ? (
    <CommentComposer
      docId={targetId}
      docVersion={docVersion}
      replyTo={threadRoot}
      onPosted={() => {
        reload()
        onPosted?.()
      }}
      placeholder={commentId ? 'Write a reply…' : 'Write a comment…'}
      testID={commentId ? 'reply-composer' : 'comment-composer'}
    />
  ) : null

  if (state.status === 'loading') {
    return (
      <View>
        {composer}
        <ActivityIndicator color={theme.brand} style={styles.loader} testID="discussions-loading" />
      </View>
    )
  }
  if (state.status === 'error') {
    return (
      <View>
        {composer}
        <Text testID="discussions-error" style={styles.errorText}>
          Failed to load discussions: {state.message}
        </Text>
      </View>
    )
  }
  if (state.groups.length === 0) {
    return (
      <View>
        {composer}
        <View style={styles.empty} testID="discussions-empty">
          <Text style={styles.emptyGlyph}>💬</Text>
          <Text style={styles.emptyText}>No comments here, yet!</Text>
        </View>
      </View>
    )
  }
  return (
    <View testID="discussions-list">
      {composer}
      {state.groups.map((group) => (
        <View key={group.id} style={styles.group} testID="discussion-group">
          {group.comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              authors={state.authors}
              onPress={onOpenComment ? () => onOpenComment(comment) : undefined}
            />
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

function CommentRow({
  comment,
  authors,
  onPress,
}: {
  comment: HMComment
  authors: Record<string, HMMetadataPayload>
  onPress?: () => void
}) {
  const author = authors[comment.author]?.metadata
  const authorName = author?.name || `?${comment.author.slice(-8)}`
  const body = (
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
  if (!onPress) return body
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} testID="discussion-comment-press">
      {body}
    </TouchableOpacity>
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
