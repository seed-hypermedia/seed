import type {ModelProviderInfo} from '@/agents-client'

const ADD_PROVIDER_VALUE = '__add_provider__'

/**
 * Native select of configured model providers with a trailing "add provider"
 * option. Shared by the create-agent dialog and the agent settings page so both
 * can switch providers and add a new one in place.
 */
export function ProviderSelect({
  providers,
  value,
  onChange,
  onAddProvider,
  disabled,
}: {
  providers: ModelProviderInfo[] | undefined
  value: string
  onChange: (name: string) => void
  onAddProvider: () => void
  disabled?: boolean
}) {
  const hasValueOption = !value || providers?.some((provider) => provider.name === value)
  return (
    <select
      className="border-input bg-background rounded-md border px-3 py-2 text-sm"
      value={value}
      onChange={(event) => {
        const next = event.target.value
        if (next === ADD_PROVIDER_VALUE) onAddProvider()
        else onChange(next)
      }}
      disabled={disabled}
    >
      {/* Keep a stranded value (e.g. a since-deleted provider) selectable rather than silently switching it. */}
      {hasValueOption ? null : <option value={value}>{value}</option>}
      {(providers || []).map((provider) => (
        <option key={provider.id} value={provider.name}>
          {provider.name} ({provider.type})
        </option>
      ))}
      <option value={ADD_PROVIDER_VALUE}>+ Add provider…</option>
    </select>
  )
}
