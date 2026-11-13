import type * as api from '@/api'

/** Synthetic activity object recorded when a schedule trigger fires. */
export type ScheduleActivity = {
  type: 'schedule'
  scheduleKind: api.AgentScheduleTrigger['kind']
  scheduledAt: number
  firedAt: number
  timezone?: string
}

/** One due scheduled occurrence for an enabled schedule trigger. */
export type ScheduledOccurrence = {
  scheduledAt: number
  activityKey: string
  activity: ScheduleActivity
  summary: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
/** Returns the due occurrence for a schedule trigger, or null when it is not due. */
export function dueOccurrence(
  trigger: Pick<api.AgentTriggerInfo, 'id' | 'createdAt' | 'lastFiredAt' | 'source'>,
  now: number,
): ScheduledOccurrence | null {
  if (trigger.source.type !== 'schedule') return null
  const schedule = trigger.source.schedule
  const after = trigger.lastFiredAt ?? trigger.createdAt
  let scheduledAt: number | null = null
  if (schedule.kind === 'interval') {
    const intervalMs = schedule.every * (schedule.unit === 'hours' ? HOUR_MS : MINUTE_MS)
    const next = after + intervalMs
    scheduledAt = now >= next ? next : null
  } else if (schedule.kind === 'once') {
    scheduledAt = !trigger.lastFiredAt && now >= schedule.runAt ? schedule.runAt : null
  } else {
    scheduledAt = latestWeeklyOccurrence(schedule, now, trigger.createdAt)
    if (scheduledAt !== null && scheduledAt <= after) scheduledAt = null
  }
  if (scheduledAt === null) return null
  const activity: ScheduleActivity = {
    type: 'schedule',
    scheduleKind: schedule.kind,
    scheduledAt,
    firedAt: now,
    ...('timezone' in schedule ? {timezone: schedule.timezone} : {}),
  }
  return {
    scheduledAt,
    activityKey: `schedule:${trigger.id}:${scheduledAt}`,
    activity,
    summary: scheduleSummary(schedule, scheduledAt),
  }
}

/** Returns a short human-readable description of a schedule source. */
export function scheduleSourceSummary(schedule: api.AgentScheduleTrigger, scheduledAt?: number): string {
  if (schedule.kind === 'interval') return `every ${schedule.every} ${schedule.unit}`
  if (schedule.kind === 'once') return `once at ${new Date(schedule.runAt).toISOString()}`
  return `${schedule.daysOfWeek.map(dayName).join(', ')} at ${schedule.timeOfDay} ${schedule.timezone}`
}

/** Returns a short human-readable description of one scheduled occurrence. */
export function scheduleSummary(schedule: api.AgentScheduleTrigger, scheduledAt: number): string {
  if (schedule.kind === 'interval') return `Scheduled interval at ${new Date(scheduledAt).toISOString()}`
  if (schedule.kind === 'once') return `One-time schedule at ${new Date(scheduledAt).toISOString()}`
  return `Scheduled weekly run at ${schedule.timeOfDay} ${schedule.timezone}`
}

function latestWeeklyOccurrence(
  schedule: Extract<api.AgentScheduleTrigger, {kind: 'weekly'}>,
  now: number,
  createdAt: number,
): number | null {
  const nowParts = zonedParts(now, schedule.timezone)
  let latest: number | null = null
  for (let offset = 0; offset <= 7; offset += 1) {
    const utcNoon = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day - offset, 12, 0)
    const parts = zonedParts(utcNoon, schedule.timezone)
    if (!schedule.daysOfWeek.includes(parts.weekday)) continue
    const [hourRaw, minuteRaw] = schedule.timeOfDay.split(':')
    const hour = Number(hourRaw)
    const minute = Number(minuteRaw)
    const candidate = zonedTimeToUtcMs(parts.year, parts.month, parts.day, hour, minute, schedule.timezone)
    if (candidate <= now && candidate >= createdAt && (latest === null || candidate > latest)) latest = candidate
  }
  return latest
}

function zonedTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute)
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(guess, timeZone)
    const desired = Date.UTC(year, month - 1, day, hour, minute)
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    const diff = desired - actual
    if (diff === 0) break
    guess += diff
  }
  return guess
}

function zonedParts(
  ms: number,
  timeZone: string,
): {year: number; month: number; day: number; hour: number; minute: number; weekday: number} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const values = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: weekdayNumber(values.weekday || 'Sun'),
  }
}

function weekdayNumber(value: string): number {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value.slice(0, 3))
}

function dayName(day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] || String(day)
}
