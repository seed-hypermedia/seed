import type {ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
// Written per task and gitignored; see SKILL.md.
import {Preview} from './preview.local'
import './styles.css'

function Theme({dark, children}: {dark?: boolean; children: ReactNode}) {
  return (
    <div className={dark ? 'dark' : ''}>
      <div className="bg-background text-foreground rounded-lg border p-2">{children}</div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <div className="inline-flex items-start gap-4 bg-neutral-300 p-4">
    <Theme>
      <Preview />
    </Theme>
    <Theme dark>
      <Preview />
    </Theme>
  </div>,
)
