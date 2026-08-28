/**
 * One visible tool call on the log.
 *
 * Tool calls are durable events, not chrome — the whole point of the runtime is that you can see
 * what the agent did. The row's wording comes from the shared registry and the shared summary
 * resolver, which is also what desktop and web read, so a `read hm://…` row names the document
 * rather than the URL and a `call` row borrows the called tool's identity instead of reading
 * "Call · execute".
 *
 * Tapping expands the raw input and output — the phone's stand-in for the desktop's debug dialog.
 */

import {getSeedTool, normalizeSeedToolName} from '@seed-hypermedia/agents-protocol'
import type {ChatToolPart} from '@shm/ui/agents/chat-parts'
import {resolveToolRowSummary, toolRowSourceChip} from '@shm/ui/agents/tool-summary'
import React, {useMemo, useState} from 'react'
import {Pressable, StyleSheet, View} from 'react-native'
import {radius, theme} from '../../theme'
import {Label, Spinner, StatusDot} from '../ui/primitives'

const MAX_PAYLOAD_CHARS = 4000

export function ToolRow({part, onOpenUrl}: {part: ChatToolPart; onOpenUrl?: (url: string) => void}) {
  const [expanded, setExpanded] = useState(false)

  const tool = useMemo(() => getSeedTool(normalizeSeedToolName(part.name)), [part.name])
  const summary = useMemo(() => resolveToolRowSummary(part), [part])
  const chip = useMemo(() => toolRowSourceChip(part), [part])

  // A call with no result yet is still running; the registry supplies the present-tense wording.
  const pending = part.result === undefined && !part.isError
  const verb = summary?.verb ?? (pending ? tool?.render.pendingLabel ?? tool?.label : tool?.label ?? part.name)
  const label = part.summaryOverride ?? summary?.label ?? ''
  const targetUrl = summary?.target?.type === 'url' ? summary.target.url : undefined

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        style={({pressed}) => [styles.header, pressed && styles.pressed]}
      >
        {pending ? <Spinner /> : <StatusDot tone={part.isError ? 'error' : 'done'} />}
        <View style={styles.headerText}>
          <Label size="sm" weight="600" numberOfLines={1}>
            {verb}
            {label ? <Label size="sm"> {label}</Label> : null}
          </Label>
          {summary?.detail ? (
            <Label size="xs" tone="muted" numberOfLines={1}>
              {summary.detail}
            </Label>
          ) : null}
        </View>
        {/* The user's own verbs land on this same log; the chip says so, as on desktop. */}
        {part.actor === 'user' ? (
          <Label size="xs" tone="brand">
            You
          </Label>
        ) : null}
        {chip ? (
          <Label size="xs" tone="muted" style={styles.chip}>
            {chip}
          </Label>
        ) : null}
      </Pressable>

      {expanded ? (
        <View style={styles.details}>
          <Payload title="Input" value={part.args} />
          <Payload title={part.isError ? 'Error' : 'Output'} value={part.rawOutput ?? part.result} />
          {/* Only a url target is followable from here. A `memory` or `session` target belongs to a
              screen mobile has not built yet, and a dead link is worse than none. */}
          {targetUrl ? (
            <Pressable onPress={() => onOpenUrl?.(targetUrl)}>
              <Label size="xs" tone="brand">
                {targetUrl}
              </Label>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function Payload({title, value}: {title: string; value: unknown}) {
  if (value === undefined || value === null || value === '') return null
  const text = typeof value === 'string' ? value : safeStringify(value)
  return (
    <View style={styles.payload}>
      <Label size="xs" tone="muted" weight="600">
        {title.toUpperCase()}
      </Label>
      <Label size="xs" style={styles.mono} selectable>
        {truncate(text)}
      </Label>
    </View>
  )
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    // Circular or otherwise unserializable payloads should degrade to a note, not blank the row.
    return String(value)
  }
}

function truncate(text: string): string {
  return text.length > MAX_PAYLOAD_CHARS ? `${text.slice(0, MAX_PAYLOAD_CHARS)}\n… truncated` : text
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.lg,
    backgroundColor: theme.card,
    overflow: 'hidden',
  },
  header: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8},
  pressed: {opacity: 0.7},
  headerText: {flex: 1, gap: 1},
  chip: {fontFamily: 'Menlo'},
  details: {borderTopWidth: 1, borderTopColor: theme.border, padding: 10, gap: 10},
  payload: {gap: 3},
  mono: {fontFamily: 'Menlo', color: theme.mutedForeground},
})
