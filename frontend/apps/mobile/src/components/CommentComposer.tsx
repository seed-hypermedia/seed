import {createComment} from '@seed-hypermedia/client/comment'
import type {HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import React, {useState} from 'react'
import {ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View} from 'react-native'
import {getSeedClient} from '../client/seed-client'
import {identityDisplayName, useAccountProfileNames, useVault} from '../screens/vault-hooks'
import {radius, theme} from '../theme'
import {getIdentitySigner} from '../vault/signing'

/**
 * Writes a comment on a document, or a reply to one, signed by the identity
 * currently selected in the vault. Same path the web takes: build the signed
 * comment blob with `createComment`, then publish it to the server.
 */
export function CommentComposer({
  docId,
  docVersion,
  replyTo,
  onPosted,
  placeholder = 'Write a comment…',
  testID = 'comment-composer',
}: {
  docId: UnpackedHypermediaId
  /** Version of the document being commented on. */
  docVersion: string
  /** When set, the new comment is a reply in that comment's thread. */
  replyTo?: HMComment
  onPosted?: () => void
  placeholder?: string
  testID?: string
}) {
  const vault = useVault()
  const identity = vault.manager?.getCurrentIdentity() ?? null
  // Desktop-parity naming: the published profile name, not the local key name.
  const profileNames = useAccountProfileNames(identity ? [identity.accountId] : [])
  const [text, setText] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!identity) {
    return (
      <View style={styles.container} testID={`${testID}-no-identity`}>
        <Text style={styles.notice}>Select an identity in the sidebar to comment.</Text>
      </View>
    )
  }

  const canPost = text.trim().length > 0 && !posting

  async function post() {
    if (!identity || !canPost) return
    setPosting(true)
    setError(null)
    try {
      const signer = await getIdentitySigner(identity.accountId)
      const publishInput = await createComment(
        {
          docId,
          docVersion,
          content: [
            {
              block: {type: 'Paragraph', id: 'c1', text: text.trim(), annotations: [], attributes: {}},
              children: [],
            },
          ],
          // A reply hangs off its parent, and off the root of the thread the
          // parent already belongs to (itself, when replying to a thread root).
          ...(replyTo
            ? {
                replyCommentVersion: replyTo.version,
                rootReplyCommentVersion: replyTo.threadRootVersion || replyTo.version,
              }
            : {}),
        },
        signer,
      )
      await getSeedClient().publish(publishInput)
      setText('')
      onPosted?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPosting(false)
    }
  }

  return (
    <View style={styles.container} testID={testID}>
      <TextInput
        testID={`${testID}-input`}
        style={styles.input}
        value={text}
        onChangeText={(next) => {
          setText(next)
          setError(null)
        }}
        placeholder={placeholder}
        placeholderTextColor={theme.mutedForeground}
        multiline
      />
      <View style={styles.row}>
        <Text style={styles.author} numberOfLines={1}>
          as {identityDisplayName(identity, profileNames[identity.accountId])}
        </Text>
        <TouchableOpacity
          testID={`${testID}-submit`}
          style={[styles.postButton, !canPost && styles.postButtonDisabled]}
          onPress={post}
          disabled={!canPost}
        >
          {posting ? (
            <ActivityIndicator size="small" color={theme.accentForeground} />
          ) : (
            <Text style={styles.postButtonText}>{replyTo ? 'Reply' : 'Post'}</Text>
          )}
        </TouchableOpacity>
      </View>
      {!!error && (
        <Text testID={`${testID}-error`} style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.lg,
    padding: 10,
    gap: 8,
    marginBottom: 16,
  },
  input: {
    color: theme.foreground,
    fontSize: 15,
    minHeight: 40,
    maxHeight: 160,
    padding: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  author: {
    flex: 1,
    color: theme.mutedForeground,
    fontSize: 12,
  },
  postButton: {
    minWidth: 74,
    height: 32,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postButtonDisabled: {
    opacity: 0.45,
  },
  postButtonText: {
    color: theme.accentForeground,
    fontSize: 14,
    fontWeight: '600',
  },
  notice: {
    color: theme.mutedForeground,
    fontSize: 13,
  },
  error: {
    color: theme.danger,
    fontSize: 12,
  },
})
