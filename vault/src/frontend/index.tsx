import "./styles.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { FetchClient } from "./api-client"
import { createRouter } from "./router"
import { createStore, StoreContext } from "./store"

const elem = document.getElementById("root")
if (!elem) throw new Error("root element not found")

const appStore = createStore(new FetchClient())
const router = createRouter()

// Wire up the store's navigator to the router.
appStore.navigator.setNavigate((path) => router.navigate(path))

const app = (
	<StrictMode>
		<StoreContext.Provider value={appStore}>
			<RouterProvider router={router} />
		</StoreContext.Provider>
	</StrictMode>
)

if (import.meta.hot) {
	// With hot module reloading, `import.meta.hot.data` is persisted.
	if (!import.meta.hot.data.root) {
		import.meta.hot.data.root = createRoot(elem)
	}
	const root = import.meta.hot.data.root
	root.render(app)
} else {
	// The hot module reloading API is not available in production.
	createRoot(elem).render(app)
}
