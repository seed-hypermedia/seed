// Document-menu entry points to the blob editor: "New Blob" (a blank DAG-CBOR
// object) and "New Schema" (a new instance of the bundled meta-schema). Both
// open the inspector's draft mode: `inspect-ipfs` with `new` / `new/<schemaCid>`.
import {createInspectIpfsNavRoute, type NavRoute} from '@shm/shared/routes'
import {Braces, FileCode2} from 'lucide-react'
import type {MenuItemType} from '../options-dropdown'
import {schemaCid} from './onyx-engine'

/** The inspector path that opens a blank new blob draft. */
export const NEW_BLOB_PATH = 'new'
/** The inspector path that opens a draft seeded by a schema blob. */
export const newInstancePath = (schemaBlobCid: string) => `${NEW_BLOB_PATH}/${schemaBlobCid}`
/** The Onyx meta-schema's published CID — "New Schema" is a new instance of it. */
export const META_SCHEMA_CID = schemaCid('onyx-schema')!

export const newBlobRoute = (): NavRoute => createInspectIpfsNavRoute(NEW_BLOB_PATH)
export const newInstanceRoute = (schemaBlobCid: string): NavRoute =>
  createInspectIpfsNavRoute(newInstancePath(schemaBlobCid))

export function blobBuilderMenuItems(navigate: (route: NavRoute) => void): MenuItemType[] {
  return [
    {
      key: 'new-raw-blob',
      label: 'New Blob',
      icon: <Braces className="size-4" />,
      onClick: () => navigate(newBlobRoute()),
    },
    {
      key: 'new-schema',
      label: 'New Schema',
      icon: <FileCode2 className="size-4" />,
      onClick: () => navigate(newInstanceRoute(META_SCHEMA_CID)),
    },
  ]
}
