import { rm } from "node:fs/promises"
import tailwind from "bun-plugin-tailwind"

const OUTDIR = "./dist"

await rm(OUTDIR, { recursive: true, force: true })

const result = await Bun.build({
	entrypoints: ["./src/main.ts"],
	outdir: OUTDIR,
	target: "bun",
	minify: process.env.NODE_ENV === "production",
	sourcemap: "linked",
	naming: {
		chunk: "[dir]/[name].[hash].[ext]",
		asset: "[dir]/[name].[hash].[ext]",
	},
	publicPath: "/vault/",
	root: "./src",
	plugins: [tailwind],
})

if (!result.success) {
	console.error("Build failed:")
	for (const log of result.logs) {
		console.error(log)
	}
	process.exit(1)
}

console.log("Build succeeded!")
for (const output of result.outputs) {
	console.log(`  ${output.path}`)
}
