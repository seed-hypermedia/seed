import {PanelContainer} from '@shm/ui/container'

/**
 * Route-level fallback while a page chunk loads: the page frame alone — the panel's real
 * background and border, holding nothing. Fake skeleton lines here promised content that a blank
 * page (or a slow chunk) never delivers; an empty frame just reads as "the page is on its way".
 */
export function DocumentPlaceholder() {
  return <PanelContainer />
}
