/**
 * The playground page is a handful of static files under ./static. Vite inlines them into the
 * main-process bundle (`?raw`), so nothing has to be copied into the packaged app.
 */
import appJs from './static/app.mjs?raw'
import editorJs from './static/editor.mjs?raw'
import indexHtml from './static/index.html?raw'
import styleCss from './static/style.css?raw'
import uiJs from './static/ui.mjs?raw'
import syncJs from './static/sync.mjs?raw'
import syncConceptsJs from './static/sync-concepts.mjs?raw'

export type PlaygroundAsset = {body: string; contentType: string}

const JS = 'text/javascript; charset=utf-8'

export const playgroundAssets: Record<string, PlaygroundAsset> = {
  'index.html': {body: indexHtml, contentType: 'text/html; charset=utf-8'},
  'style.css': {body: styleCss, contentType: 'text/css; charset=utf-8'},
  'app.mjs': {body: appJs, contentType: JS},
  'editor.mjs': {body: editorJs, contentType: JS},
  'ui.mjs': {body: uiJs, contentType: JS},
  'sync.mjs': {body: syncJs, contentType: JS},
  'sync-concepts.mjs': {body: syncConceptsJs, contentType: JS},
}
