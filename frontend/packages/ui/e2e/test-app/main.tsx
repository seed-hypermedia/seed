import React, {lazy, Suspense} from 'react'
import ReactDOM from 'react-dom/client'
import {TestSchemaEditor} from './TestSchemaEditor'

const TestCardNavigation = lazy(() =>
  import('./TestCardNavigation').then((module) => ({default: module.TestCardNavigation})),
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback="Loading…">
      {new URLSearchParams(window.location.search).has('sidebar') ? <TestCardNavigation /> : <TestSchemaEditor />}
    </Suspense>
  </React.StrictMode>,
)
