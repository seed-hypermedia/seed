import {QueryClientProvider, UniversalAppProvider} from '@shm/shared'
import React from 'react'
import ReactDOM from 'react-dom/client'
import {ErrorBoundary} from 'react-error-boundary'
import {BrowserRouter} from 'react-router-dom'
import App from './App'
import {ErrorFallback} from './components/ErrorBoundary'
import './index.css'
import {queryClient} from './queryClient'
import {exploreUniversalClient} from './universal-client'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <UniversalAppProvider
            universalClient={exploreUniversalClient}
            openUrl={(url) => window.open(url, '_blank')}
            openRoute={null}
          >
            <App />
          </UniversalAppProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
