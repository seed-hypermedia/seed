import {Server} from 'lucide-react'
import type {ReactNode} from 'react'
import {SettingsRow, SettingsSection} from './settings-list'

/** A server URL as people read it: its host, or "this computer" for the local server. */
export function describeHostServer(serverUrl: string, localServerUrl?: string | null): string {
  if (!serverUrl) return ''
  if (localServerUrl && serverUrl.replace(/\/$/, '') === localServerUrl.replace(/\/$/, '')) return 'This computer'
  try {
    return new URL(serverUrl).host
  } catch {
    return serverUrl
  }
}

/**
 * The server something is hosted on, as the first card of its settings. Agents always have one;
 * an app may have none, which leaves it a template until someone chooses a server.
 */
export function ServerHostSection({
  serverUrl,
  localServerUrl,
  detail,
  action,
  emptyLabel = 'Not hosted',
  emptyDetail,
}: {
  serverUrl: string
  localServerUrl?: string | null
  /** One line under the server: its status, or where the choice comes from. */
  detail?: ReactNode
  action?: ReactNode
  emptyLabel?: string
  emptyDetail?: ReactNode
}) {
  const host = describeHostServer(serverUrl, localServerUrl)
  return (
    <SettingsSection label="Server">
      <SettingsRow
        icon={<Server />}
        label={host || emptyLabel}
        description={
          host ? (
            <>
              {host !== serverUrl ? <span className="font-mono">{serverUrl}</span> : null}
              {host !== serverUrl && detail ? ' · ' : null}
              {detail}
            </>
          ) : (
            emptyDetail
          )
        }
        action={action}
      />
    </SettingsSection>
  )
}
