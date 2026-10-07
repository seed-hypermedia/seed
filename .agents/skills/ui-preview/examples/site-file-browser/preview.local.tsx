import {hmId} from '@shm/shared'
import {SiteFileBrowser} from '@shm/ui/site-file-browser'

const active = hmId('site', {path: ['design', 'stories', 'explore', 'attribute']})

/** Renders the site file browser with the fixture tree, revealing a nested active document. */
export function Preview() {
  return (
    <div className="h-[560px] w-[320px] overflow-hidden">
      <SiteFileBrowser siteId={hmId('site')} activeDocumentId={active} onNavigate={() => {}} />
    </div>
  )
}
