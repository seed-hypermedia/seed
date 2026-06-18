import * as React from 'react'

/**
 * A labeled group of settings rows rendered as a bordered card. Used to group
 * related settings (e.g. authentication, notifications) under an uppercase label.
 */
export function SettingsSection({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">{label}</p>
      <div className="bg-muted/50 overflow-hidden rounded-lg border">{children}</div>
    </div>
  )
}

/**
 * A single settings entry: an icon, a label with optional description, and an
 * optional trailing action (typically a button). Render `Separator` between
 * consecutive rows.
 */
export function SettingsRow({
  icon,
  label,
  description,
  action,
}: {
  icon: React.ReactNode
  label: string
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full [&_svg]:size-4">
          {icon}
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="text-sm font-medium">{label}</p>
          {description ? <p className="text-muted-foreground text-xs">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
