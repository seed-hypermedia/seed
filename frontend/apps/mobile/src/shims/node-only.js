// Metro resolves Node-only packages (cheerio, pdfjs-dist — see metro.config.js)
// here on native. They are reachable through the @seed-hypermedia/client barrel
// (tei-to-blocks, pdf-to-blocks) but never invoked on mobile: cheerio needs
// node:stream and pdfjs-dist uses syntax Hermes cannot parse. Any use throws at
// call time instead of breaking the bundle.
module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === '__esModule') return true
      return () => {
        throw new Error(`This Node-only module is not available in the mobile app (accessed .${String(prop)})`)
      }
    },
  },
)
