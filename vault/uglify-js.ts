// Stub for uglify-js. It's pulled in via html-minifier (a transitive dep of mjml),
// which does a top-level require("uglify-js") as a side-effect.
// MJML never calls it because minify is off by default.
export const minify = () => ({ code: "", error: null })
export const FILES = []
