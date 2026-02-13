/**
 * Demo server for the Hypermedia Auth delegation flow.
 * Serves the demo page on port 8081 and builds the React app on-the-fly using Bun's HTML loader.
 */
import spa from "./index.html"

const server = Bun.serve({
	port: 8081,
	routes: {
		"/*": spa,
	},
})

console.log(`\uD83C\uDF10 Demo site running at http://localhost:${server.port}`)
