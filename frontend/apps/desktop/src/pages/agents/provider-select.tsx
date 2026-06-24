import type {ModelProviderInfo} from '@/agents-client'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@shm/ui/select-dropdown'

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
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === ADD_PROVIDER_VALUE) onAddProvider()
        else onChange(next)
      }}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder="Select a provider" />
      </SelectTrigger>
      <SelectContent>
        {/* Keep a stranded value (e.g. a since-deleted provider) selectable rather than silently switching it. */}
        {hasValueOption ? null : <SelectItem value={value}>{value}</SelectItem>}
        {(providers || []).map((provider) => (
          <SelectItem key={provider.id} value={provider.name}>
            {provider.name} ({provider.type})
          </SelectItem>
        ))}
        <SelectItem value={ADD_PROVIDER_VALUE}>+ Add provider…</SelectItem>
      </SelectContent>
    </Select>
  )
}
