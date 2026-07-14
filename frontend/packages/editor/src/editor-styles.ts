/**
 * Eager style entry for the editor's document markup.
 *
 * The server-rendered document HTML (ssr-render.tsx) carries the same hashed
 * CSS-module class names as the mounted editor. Those stylesheets normally
 * ship inside the lazily loaded document-editor chunk, which would leave the
 * SSR HTML unstyled until that chunk arrives — importing this entry from the
 * web app root loads them with the initial page instead. The hashed names
 * match because server and client share one Vite module graph.
 */
import './blocknote/core/editor.module.css'
import './blocknote/core/extensions/Blocks/nodes/Block.module.css'
import './editor.css'
import './image.css'
import './inline-embed.css'
