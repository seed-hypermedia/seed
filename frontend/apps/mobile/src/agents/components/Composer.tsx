/**
 * The message composer.
 *
 * Desktop composes in the Seed block editor; mobile sends plain markdown, which is what
 * `MessageSessionContentPart` takes when its optional `blocks` are absent. Multi-line by design —
 * Return inserts a newline rather than sending, because on a phone the send button is right there
 * and a Return-to-send composer makes a paragraph impossible to type.
 *
 * The agent being busy does not disable the field: the server persists concurrent messages
 * immediately and serializes their model turns, so a follow-up thought can be typed and sent while
 * the current turn is still running.
 */

import React, {useState} from 'react'
import {StyleSheet, TextInput, View} from 'react-native'
import {radius, theme} from '../../theme'
import {Button, ErrorNote, Label, Spinner} from '../ui/primitives'

export function Composer({
  onSubmit,
  busy,
  activity,
  onStop,
  error,
}: {
  onSubmit: (text: string) => void
  /** A model turn is running: shows what it is doing and offers Stop. */
  busy?: boolean
  /** The current activity phase from the live subscription, when the runtime reported one. */
  activity?: string
  onStop?: () => void
  error?: string
}) {
  const [text, setText] = useState('')

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setText('')
    onSubmit(trimmed)
  }

  return (
    <View style={styles.root}>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {busy ? (
        <View style={styles.statusRow}>
          <Spinner />
          <Label size="xs" tone="muted" style={styles.flex}>
            {activity ? activityLabel(activity) : 'Working…'}
          </Label>
          {onStop ? (
            <Button size="sm" variant="ghost" onPress={onStop}>
              Stop
            </Button>
          ) : null}
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          testID="agent-composer-input"
          value={text}
          onChangeText={setText}
          placeholder="Message the agent"
          placeholderTextColor={theme.mutedForeground}
          multiline
          style={styles.input}
        />
        <Button variant="primary" onPress={submit} disabled={!text.trim()} testID="agent-composer-send">
          Send
        </Button>
      </View>
    </View>
  )
}

/** Turns the runtime's activity phase into something worth reading. */
function activityLabel(phase: string): string {
  switch (phase) {
    case 'thinking':
      return 'Thinking…'
    case 'tool':
      return 'Running a tool…'
    case 'responding':
      return 'Replying…'
    default:
      return 'Working…'
  }
}

const styles = StyleSheet.create({
  root: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    padding: 12,
    gap: 8,
    backgroundColor: theme.background,
  },
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  flex: {flex: 1},
  inputRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 8},
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 140,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.foreground,
    fontSize: 15,
  },
})
