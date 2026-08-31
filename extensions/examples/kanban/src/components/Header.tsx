import type {ExtensionUser} from '@seed-hypermedia/extension-sdk'

type Props = {
  title: string
  user: ExtensionUser | null
  dirty: boolean
  saving: boolean
  canSave: boolean
  autoSave: boolean
  onSave: () => void
  onReload: () => void
  onToggleAutoSave: (enabled: boolean) => void
  onAddColumn: () => void
}

export function Header({
  title,
  user,
  dirty,
  saving,
  canSave,
  autoSave,
  onSave,
  onReload,
  onToggleAutoSave,
  onAddColumn,
}: Props) {
  return (
    <header className="header">
      <div className="header-left">
        <h1>{title}</h1>
        <span className="user">{user ? user.name || user.accountId : 'Not signed in'}</span>
      </div>
      <div className="header-right">
        {dirty && <span className="unsaved">Unsaved changes</span>}
        <label className="toggle">
          <input
            type="checkbox"
            checked={autoSave}
            disabled={!canSave}
            onChange={(e) => onToggleAutoSave(e.target.checked)}
          />
          Auto-save
        </label>
        <button onClick={onAddColumn}>Add column</button>
        <button onClick={onReload}>Reload from network</button>
        <button className="primary" onClick={onSave} disabled={!canSave || !dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </header>
  )
}
