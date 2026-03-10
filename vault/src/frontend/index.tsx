import {createRoot} from 'react-dom/client'
import {RouterProvider} from 'react-router-dom'
import {FetchClient} from './api-client'
import {IndexedDBBlockstore, RemoteBlockstore} from './blockstore'
import {createRouter} from './router'
import {createStore, StoreContext} from './store'
import './styles.css'

const elem = document.getElementById('root')
if (!elem) throw new Error('root element not found')
const rootElem = elem

async function bootstrap() {
  const client = new FetchClient()
  const {backendBaseUrl} = await client.getConfig()
  const appStore = createStore(client, new IndexedDBBlockstore(new RemoteBlockstore(backendBaseUrl)))
  const router = createRouter()

  // Wire up the store's navigator to the router.
  appStore.navigator.setNavigate((path) => router.navigate(path))

  const app = (
    <StoreContext.Provider value={appStore}>
      <RouterProvider router={router} />
    </StoreContext.Provider>
  )

  if (import.meta.hot) {
    // With hot module reloading, `import.meta.hot.data` is persisted.
    if (!import.meta.hot.data.root) {
      import.meta.hot.data.root = createRoot(rootElem)
    }
    const root = import.meta.hot.data.root
    root.render(app)
  } else {
    // The hot module reloading API is not available in production.
    createRoot(rootElem).render(app)
  }
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap vault app', error)
  createRoot(rootElem).render(null)
})
