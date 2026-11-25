import {useEffect, useRef, useState, type ReactNode} from 'react'
import {Button} from '../button'
import {Input} from '../components/input'
import {SelectDropdown} from '../select-dropdown'
import {SizableText} from '../text'
import {normalizeAgentServerUrl} from './client'
import {
  describeAgentServer,
  getDefaultAgentServerUrl,
  isLocalAgentServer,
  useAgentServerUrl,
  useLocalAgentServerUrl,
} from './models'

/** Dropdown value of the row that asks for a URL instead of naming a server. */
const ANOTHER_SERVER = '__another-server__'

/**
 * Chooses the app environment something runs on: one of the servers the app already knows, or any
 * other by its URL. There is no list to configure first; `options` are suggestions (see
 * `useAgentServerOptions`) and a typed URL is as good as a listed one.
 */
export function AgentServerPicker({
  value,
  onChange,
  options,
  disabled,
}: {
  /** The chosen server URL, or '' when none is chosen yet. */
  value: string
  onChange: (serverUrl: string) => void
  /** Servers to offer by name. The chosen one is listed even when it is not among them. */
  options: readonly string[]
  disabled?: boolean
}) {
  const localServerUrl = useLocalAgentServerUrl()
  const listed = value && !options.includes(value) ? [...options, value] : options
  // With nothing to pick from, the URL field is the picker.
  const [askedToType, setTyping] = useState(false)
  const typing = askedToType || listed.length === 0
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function useDraft() {
    try {
      const serverUrl = normalizeAgentServerUrl(draft)
      setError(null)
      setTyping(false)
      setDraft('')
      onChange(serverUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a server URL')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {listed.length ? (
        <SelectDropdown
          options={[
            ...listed.map((serverUrl) => ({
              value: serverUrl,
              label: describeAgentServer(serverUrl, localServerUrl.data),
            })),
            {value: ANOTHER_SERVER, label: 'Another server…'},
          ]}
          value={typing ? ANOTHER_SERVER : value}
          onValue={(next) => {
            if (next === ANOTHER_SERVER) {
              setTyping(true)
              return
            }
            setTyping(false)
            setError(null)
            onChange(next)
          }}
          placeholder="Select a server"
          disabled={disabled}
        />
      ) : null}
      {typing ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            aria-label="Server URL"
            value={draft}
            disabled={disabled}
            placeholder="https://agents.example.com"
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              // The picker sits inside forms; Enter here chooses the server, it does not submit.
              event.preventDefault()
              useDraft()
            }}
          />
          <Button type="button" variant="outline" onClick={useDraft} disabled={disabled || !draft.trim()}>
            Use server
          </Button>
        </div>
      ) : null}
      {error ? (
        <SizableText size="xs" className="text-destructive" role="alert">
          {error}
        </SizableText>
      ) : null}
    </div>
  )
}

/**
 * The server a new agent or app goes to unless the user picks another: the one used last, else the
 * first offered server that is not the app's own local one.
 */
export function pickCreateAgentServer(
  serverUrls: readonly string[],
  {
    defaultServerUrl,
    localServerUrl,
  }: {
    defaultServerUrl?: string | null
    localServerUrl?: string | null
  },
): string {
  if (defaultServerUrl && serverUrls.includes(defaultServerUrl)) return defaultServerUrl
  const remote = serverUrls.find((serverUrl) => !isLocalAgentServer(serverUrl, localServerUrl))
  return remote || serverUrls[0] || getDefaultAgentServerUrl() || ''
}

/**
 * The server choice of a create dialog, as state: it starts on {@link pickCreateAgentServer}'s
 * answer and follows it while the lists are still loading, until the user picks one or `locked`
 * says the choice has been acted on (a published document already names the server).
 */
export function useCreateServerChoice(serverUrls: readonly string[] | undefined, locked = false) {
  const localServerUrl = useLocalAgentServerUrl()
  const lastUsed = useAgentServerUrl()
  const pick = () =>
    pickCreateAgentServer(serverUrls ?? [], {defaultServerUrl: lastUsed.data, localServerUrl: localServerUrl.data})
  const [serverUrl, setServerUrl] = useState(pick)
  const picked = useRef(false)
  useEffect(() => {
    if (picked.current || locked) return
    setServerUrl(pick())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverUrls, lastUsed.data, localServerUrl.data])
  return {
    serverUrl,
    setServerUrl: (next: string) => {
      picked.current = true
      setServerUrl(next)
    },
  }
}

/**
 * Where a create dialog says what the new thing runs on. The server is stated, with the choice
 * behind a Change link: things go to the main server unless the user says otherwise. Changing
 * offers the known servers and takes any URL (see {@link AgentServerPicker}).
 */
export function CreateServerChoice({
  value,
  onChange,
  options,
  locked,
  children,
}: {
  value: string
  onChange: (serverUrl: string) => void
  options: readonly string[]
  /** The choice can no longer change: something already published names this server. */
  locked?: boolean
  /** Shown under the picker, e.g. a notice that the chosen server does not answer. */
  children?: ReactNode
}) {
  const localServerUrl = useLocalAgentServerUrl()
  const [choosing, setChoosing] = useState(false)
  if (choosing || !value) {
    return (
      <div className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Run on
        </SizableText>
        <AgentServerPicker options={options} value={value} onChange={onChange} disabled={locked} />
        {children}
      </div>
    )
  }
  // The desktop-managed server is a named place; its localhost address is an implementation
  // detail whose port moves between launches.
  const label = isLocalAgentServer(value, localServerUrl.data) ? 'Local' : value.replace(/^https?:\/\//, '')
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <SizableText size="sm" className="text-muted-foreground">
          Runs on {label}
        </SizableText>
        {locked ? null : (
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setChoosing(true)}>
            Change
          </Button>
        )}
      </div>
      {children}
    </div>
  )
}
