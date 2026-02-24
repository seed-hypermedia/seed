const stubPath = `${import.meta.dirname}/uglify-js-stub.ts`

/**
 * Redirects html-minifier's top-level "uglify-js" import to a local stub so
 * Bun can bundle MJML without pulling in the CommonJS uglify-js package.
 */
export default {
	name: "stub-uglify-js",
	setup(build) {
		build.onResolve({ filter: /^uglify-js$/ }, () => ({
			path: stubPath,
		}))
	},
} satisfies Bun.BunPlugin
