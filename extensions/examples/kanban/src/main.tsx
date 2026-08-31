import {connect, injectBaseStyles, type SeedExtension} from '@seed-hypermedia/extension-sdk'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import {App} from './App'
import {describeError} from './errors'
import './styles.css'

injectBaseStyles()

const root = createRoot(document.getElementById('root')!)
root.render(<p className="muted padded">Connecting to the Seed host…</p>)

connect()
  .then((seed: SeedExtension) => {
    root.render(
      <StrictMode>
        <App seed={seed} />
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    root.render(<p className="error padded">Could not connect: {describeError(error)}</p>)
  })
