import {SizableText} from '@shm/ui/text'

/** Shared building blocks for settings sections (settings.tsx + plugin manager). */

export function SettingsCard({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div>
      <SizableText size="xs" weight="bold" className="text-muted-foreground mb-2 tracking-wider">
        {label}
      </SizableText>
      <div className="bg-muted dark:bg-background rounded-lg border">{children}</div>
    </div>
  )
}

export function SettingsRow({
  label,
  description,
  right,
}: {
  label: string
  description?: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <SizableText size="sm" weight="medium">
          {label}
        </SizableText>
        {description ? (
          <SizableText size="xs" className="text-muted-foreground">
            {description}
          </SizableText>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  )
}
