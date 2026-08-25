/**
 * The run card: what the agent is actually doing this turn.
 *
 * A plain question is answered by the reply, and needs no card. This exists for the turns where the
 * answer is not the whole story — a checklist, delegated children, a run parked on a timer or on
 * you. It is durable-first: the tree comes from `ListRuns` and the subscription only animates it,
 * so backgrounding the app and coming back reconstructs the same card.
 *
 * Two deliberate behaviours carried over from desktop, because getting them wrong misleads:
 *   - a step the *runtime* closed (every attached child succeeded) is marked `auto`, so the
 *     checklist never attributes the runtime's bookkeeping to the agent's judgment;
 *   - a `waiting` run stays visible rather than collapsing, because it may be waiting on you.
 */

import type {RunPlanStep} from '@seed-hypermedia/agents-protocol'
import type {RunInfo, RunPlan} from '@shm/ui/agents/client'
import React, {useEffect, useState} from 'react'
import {StyleSheet, View} from 'react-native'
import {radius, theme} from '../../theme'
import {formatDuration, formatTokens} from '../format'
import {isRunLive, runStatusLabel, runStatusTone} from '../session-status'
import {Badge, Button, Card, Label, StatusDot} from '../ui/primitives'

const STEP_GLYPH: Record<RunPlanStep['status'], string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  failed: '✕',
  skipped: '–',
}

export function RunCard({
  run,
  children,
  plan,
  onCancel,
  onAnswer,
  onOpenChild,
}: {
  run: RunInfo
  /** Every other run in this tree, for the children attached to plan steps. */
  children: RunInfo[]
  /** The checklist to draw when it is not the run's own (a session-level plan). */
  plan?: RunPlan
  onCancel?: () => void
  onAnswer?: (signal: string) => void
  onOpenChild?: (child: RunInfo) => void
}) {
  const live = isRunLive(run.status)
  const elapsed = useElapsed(run, live)
  const steps = (plan ?? run.plan)?.steps ?? []
  const totalTokens = run.usage?.total

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <StatusDot tone={runStatusTone(run.status)} />
        <Label size="sm" weight="600" numberOfLines={1} style={styles.flex}>
          {run.title}
        </Label>
        <Badge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
      </View>

      <View style={styles.metaRow}>
        <Label size="xs" tone="muted">
          {formatDuration(elapsed)}
        </Label>
        {totalTokens ? (
          <Label size="xs" tone="muted">
            · {formatTokens(totalTokens)} tokens
          </Label>
        ) : null}
      </View>

      {steps.length > 0 ? (
        <View style={styles.steps}>
          {steps.map((step) => (
            <PlanStepRow
              key={step.id}
              step={step}
              run={run}
              children={children.filter((child) => attachesTo(child, step))}
              onOpenChild={onOpenChild}
            />
          ))}
        </View>
      ) : null}

      {/* Children with no home step still have to be visible — otherwise a delegating turn with no
          plan looks idle while its sub-agents work. */}
      {children
        .filter((child) => !steps.some((step) => attachesTo(child, step)))
        .map((child) => (
          <ChildRow key={child.id} child={child} onPress={onOpenChild} />
        ))}

      {run.wait ? <WaitBanner run={run} childRuns={children} onAnswer={onAnswer} /> : null}

      {run.error ? (
        <Label size="xs" tone="danger">
          {run.error.message}
        </Label>
      ) : null}

      {live && onCancel ? (
        <View style={styles.actions}>
          <Button size="sm" variant="danger" onPress={onCancel}>
            Cancel
          </Button>
        </View>
      ) : null}
    </Card>
  )
}

/**
 * Attachment resolves by step id first, then by the stamped label — so a child survives the agent
 * renaming its step between turns, which it does freely.
 */
function attachesTo(child: RunInfo, step: RunPlanStep): boolean {
  if (child.planStepId) return child.planStepId === step.id
  return !!child.stepLabel && child.stepLabel === step.label
}

/**
 * Rewrites stale step statuses once the owning run has finished, rather than leaving a checklist
 * that claims work is still running after everything stopped.
 */
function displayStepStatus(step: RunPlanStep, run: RunInfo): RunPlanStep['status'] {
  if (isRunLive(run.status)) return step.status
  if (step.status === 'running') return 'done'
  if (step.status === 'pending') return 'skipped'
  return step.status
}

function PlanStepRow({
  step,
  run,
  children,
  onOpenChild,
}: {
  step: RunPlanStep
  run: RunInfo
  children: RunInfo[]
  onOpenChild?: (child: RunInfo) => void
}) {
  const status = displayStepStatus(step, run)
  return (
    <View style={styles.stepGroup}>
      <View style={styles.stepRow}>
        <Label size="sm" tone="muted" style={styles.stepGlyph}>
          {STEP_GLYPH[status]}
        </Label>
        <Label size="sm" style={styles.flex} tone={status === 'skipped' ? 'muted' : 'default'}>
          {step.label}
        </Label>
        {step.resolvedBy === 'runtime' ? (
          <Label size="xs" tone="muted" style={styles.autoMark}>
            AUTO
          </Label>
        ) : null}
      </View>
      {children.map((child) => (
        <ChildRow key={child.id} child={child} onPress={onOpenChild} indented />
      ))}
    </View>
  )
}

function ChildRow({
  child,
  onPress,
  indented,
}: {
  child: RunInfo
  onPress?: (child: RunInfo) => void
  indented?: boolean
}) {
  return (
    <Card
      style={[styles.childRow, indented && styles.childIndented]}
      onPress={onPress ? () => onPress(child) : undefined}
    >
      <StatusDot tone={runStatusTone(child.status)} size={6} />
      <Label size="xs" numberOfLines={1} style={styles.flex}>
        {child.title}
      </Label>
      <Label size="xs" tone="muted">
        {runStatusLabel(child.status)}
      </Label>
    </Card>
  )
}

/**
 * Why a run is parked, said specifically. "Waiting" alone hides the one case a person has to act
 * on: an event wait whose answer is a button here.
 */
function WaitBanner({
  run,
  childRuns,
  onAnswer,
}: {
  run: RunInfo
  childRuns: RunInfo[]
  onAnswer?: (signal: string) => void
}) {
  const wait = run.wait!
  if (wait.reason === 'children') {
    const done = childRuns.filter((child) => !isRunLive(child.status)).length
    return (
      <Label size="xs" tone="muted">
        Waiting on {childRuns.length} sub-session{childRuns.length === 1 ? '' : 's'} — {done} done
      </Label>
    )
  }
  if (wait.reason === 'timer') {
    return <TimerBanner wakeAt={wait.wakeAt} />
  }
  const signal = wait.answerWith
  return (
    <View style={styles.waitRow}>
      <Label size="xs" tone="muted" style={styles.flex}>
        {wait.reason === 'budget-pause' ? 'Paused on its budget — resume to continue.' : 'Waiting for an answer.'}
      </Label>
      {signal && onAnswer ? (
        <Button size="sm" variant="primary" onPress={() => onAnswer(signal)}>
          {wait.reason === 'budget-pause' ? 'Resume' : 'Answer'}
        </Button>
      ) : null}
    </View>
  )
}

function TimerBanner({wakeAt}: {wakeAt?: number}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  if (!wakeAt)
    return (
      <Label size="xs" tone="muted">
        Waiting on a timer.
      </Label>
    )
  const remaining = Math.max(0, wakeAt - now)
  return (
    <Label size="xs" tone="muted">
      Waking in {formatDuration(remaining)}
    </Label>
  )
}

/** Elapsed time that ticks while the run is live and freezes with it when it ends. */
function useElapsed(run: RunInfo, live: boolean): number {
  const start = run.startedAt ?? run.createdAt
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [live])
  if (!live) return (run.finishedAt ?? run.updatedAt) - start
  return now - start
}

const styles = StyleSheet.create({
  card: {gap: 10},
  header: {flexDirection: 'row', alignItems: 'center', gap: 8},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
  flex: {flex: 1},
  steps: {gap: 6},
  stepGroup: {gap: 4},
  stepRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 8},
  stepGlyph: {minWidth: 14},
  autoMark: {letterSpacing: 0.6},
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: radius.md,
    backgroundColor: theme.background,
  },
  childIndented: {marginLeft: 22},
  waitRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  actions: {flexDirection: 'row', justifyContent: 'flex-end'},
})
