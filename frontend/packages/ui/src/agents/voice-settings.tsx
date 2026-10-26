import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useState} from 'react'
import {sendAgentAction} from './client'
import type {GetVoiceSettingsResponse, SetVoiceSettings, VoiceKeySource} from '@seed-hypermedia/agents-protocol'
import {useLocalAgentServerUrl} from './models'
import {getAgentsPlatform} from './platform'

// Keys belong to the signed account on the selected server; stored values are never returned.
// An empty Save preserves the current key; Clear falls back to the server's shared key.

type VoiceKeyField = 'deepgramApiKey' | 'cartesiaApiKey'

const VOICE_KEY_FIELDS: {field: VoiceKeyField; label: string; description: string}[] = [
  {field: 'deepgramApiKey', label: 'Deepgram API key', description: 'Speech to text for what you say.'},
  {field: 'cartesiaApiKey', label: 'Cartesia API key', description: 'Text to speech for what the agent replies.'},
]

function voiceSettingsQueryKey(serverUrl: string | null | undefined, accountUid: string | null | undefined) {
  return ['agents', 'voice-settings', serverUrl, accountUid] as const
}

/** Loads where each speech key comes from on `serverUrl` for `accountUid`. */
export function useVoiceSettings(serverUrl: string | null | undefined, accountUid: string | null | undefined) {
  return useQuery({
    queryKey: voiceSettingsQueryKey(serverUrl, accountUid),
    enabled: !!serverUrl && !!accountUid,
    queryFn: async (): Promise<GetVoiceSettingsResponse> => {
      const response = await sendAgentAction({
        serverUrl: serverUrl!,
        accountUid: accountUid!,
        action: {_: 'GetVoiceSettings'},
      })
      if (response._ !== 'GetVoiceSettingsResponse') throw new Error('Unexpected response from the agent server')
      return response
    },
    retry: false,
    useErrorBoundary: false,
  })
}

/** Stores (a string) or clears (`null`) one of the account's speech keys on `serverUrl`. */
export function useSetVoiceSettings(serverUrl: string | null | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (patch: Omit<SetVoiceSettings, '_'>) => {
      if (!serverUrl || !accountUid) throw new Error('Choose an agent server and account')
      const response = await sendAgentAction({serverUrl, accountUid, action: {_: 'SetVoiceSettings', ...patch}})
      if (response._ !== 'SetVoiceSettingsResponse') throw new Error('Unexpected response from the agent server')
      return response
    },
    onSuccess: () => invalidateQueries(voiceSettingsQueryKey(serverUrl, accountUid)),
  })
}

function describeKeySource(source: VoiceKeySource | undefined): string {
  if (source === 'account') return 'Using your key'
  if (source === 'server') return "Using the server's key"
  return 'Not set'
}

/** Speech credentials for the desktop's local server. Session controls use VoiceServerSettings instead. */
export function VoiceSettingsCard() {
  const localServer = useLocalAgentServerUrl()
  const accountUid = getAgentsPlatform().useAccountUid()
  return <VoiceServerSettings serverUrl={localServer.data ?? null} accountUid={accountUid} />
}

/** Manages the signed account's speech keys on the server hosting the current session. */
export function VoiceServerSettings({
  serverUrl,
  accountUid,
}: {
  serverUrl: string | null
  accountUid: string | null | undefined
}) {
  const settings = useVoiceSettings(serverUrl, accountUid)
  const blockedReason = !serverUrl
    ? 'Connect to an agent server to set up voice.'
    : !accountUid
      ? 'Sign in to manage your voice keys.'
      : null

  return (
    <div>
      <SizableText size="xs" weight="bold" className="text-muted-foreground mb-2 tracking-wider">
        VOICE
      </SizableText>
      <div className="bg-muted dark:bg-background rounded-lg border">
        <div className="flex flex-col gap-1 px-4 py-3">
          <SizableText size="sm" weight="medium">
            Speech API keys
          </SizableText>
          <SizableText size="xs" className="text-muted-foreground">
            Used by the mic button in agent chats. Your keys are stored encrypted on this session’s agent server and
            override its shared keys.
          </SizableText>
          <VoiceAvailabilityLine blockedReason={blockedReason} settings={settings} />
        </div>
        {VOICE_KEY_FIELDS.map((spec) => (
          <VoiceKeyRow
            key={`${serverUrl}:${accountUid}:${spec.field}`}
            spec={spec}
            serverUrl={serverUrl}
            accountUid={accountUid}
            source={settings.data?.[spec.field]}
            disabled={!!blockedReason || settings.isLoading || settings.isError}
          />
        ))}
      </div>
    </div>
  )
}

function VoiceAvailabilityLine({
  blockedReason,
  settings,
}: {
  blockedReason: string | null
  settings: ReturnType<typeof useVoiceSettings>
}) {
  let text: string
  let tone = 'text-muted-foreground'
  if (blockedReason) {
    text = blockedReason
  } else if (settings.isLoading) {
    text = 'Checking voice availability…'
  } else if (settings.isError) {
    text = settings.error instanceof Error ? settings.error.message : 'Could not read voice settings from the server'
    tone = 'text-destructive'
  } else if (settings.data?.available) {
    text = 'Voice is available on this server.'
  } else {
    text = 'Voice is not enabled on this server. Ask its administrator to set it up.'
  }
  return (
    <SizableText size="xs" className={tone} aria-live="polite">
      {text}
    </SizableText>
  )
}

function VoiceKeyRow({
  spec,
  serverUrl,
  accountUid,
  source,
  disabled,
}: {
  spec: (typeof VOICE_KEY_FIELDS)[number]
  serverUrl: string | null
  accountUid: string | null | undefined
  source: VoiceKeySource | undefined
  disabled: boolean
}) {
  const [value, setValue] = useState('')
  const set = useSetVoiceSettings(serverUrl, accountUid)
  const busy = set.isLoading

  async function apply(next: string | null) {
    try {
      await set.mutateAsync({[spec.field]: next})
      setValue('')
      toast.success(next === null ? `${spec.label} cleared` : `${spec.label} saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not update ${spec.label}`)
    }
  }

  return (
    <div className="border-border flex flex-col gap-2 border-t px-4 py-3">
      <div className="flex flex-col">
        <SizableText size="sm" weight="medium">
          {spec.label}
        </SizableText>
        <SizableText size="xs" className="text-muted-foreground">
          {spec.description}
        </SizableText>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (value.trim()) void apply(value.trim())
        }}
      >
        <Input
          type="password"
          autoComplete="off"
          className="min-w-48 flex-1"
          placeholder={source === 'account' ? 'Paste a new key to replace yours' : 'Paste your key'}
          value={value}
          onChangeText={setValue}
          disabled={disabled || busy}
          aria-label={spec.label}
        />
        <Button type="submit" size="sm" variant="outline" disabled={disabled || busy || !value.trim()}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || busy || source !== 'account'}
          onClick={() => void apply(null)}
          title={source === 'account' ? 'Remove your key from the server' : 'No key of yours is stored'}
        >
          Clear
        </Button>
      </form>
      <SizableText size="xs" className="text-muted-foreground">
        {disabled ? '' : describeKeySource(source)}
      </SizableText>
    </div>
  )
}
