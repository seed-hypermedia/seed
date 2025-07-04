import {createHmDocLink_DEPRECATED} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {Checkbox} from '@shm/ui/components/checkbox'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {
  ExternalLink,
  Link as LinkIcon,
  TextCursorInput,
  Unlink,
} from '@shm/ui/icons'
import {Separator} from '@shm/ui/separator'
import {Tooltip} from '@shm/ui/tooltip'
import {HTMLAttributes, forwardRef} from 'react'

export type EditHyperlinkMenuProps = {
  url: string
  text: string
  update: (url: string, text: string, latest: boolean) => void
  openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
}

/**
 * Menu which opens when editing an existing hyperlink or creating a new one.
 * Provides input fields for setting the hyperlink URL and title.
 */
export const EditHyperlinkMenu = forwardRef<
  HTMLDivElement,
  EditHyperlinkMenuProps & HTMLAttributes<HTMLDivElement>
>(({url, text, update, className, ...props}, ref) => {
  return (
    <div className="bg-panel absolute bottom-0 z-10 flex flex-col gap-2 overflow-hidden rounded-md p-2 shadow-sm">
      <div className="flex items-center gap-2 p-1">
        <TextCursorInput className="size-4" />
        <Input
          className="flex-1"
          placeholder="link text"
          id="link-text"
          key={props.text}
          value={props.text}
        />
      </div>
      <div className="flex items-center gap-2 p-1">
        <LinkIcon className="size-4" />
        <Input className="flex-1" key={props.url} value={props.url} />
      </div>
      <Separator />
      <div className="flex flex-col p-1">
        <div className="flex items-center gap-2">
          {unpackedRef ? (
            <div className="flex min-w-40 items-center gap-2">
              <Checkbox
                id="link-latest"
                key={props.url}
                defaultValue={!!unpackedRef.latest}
                onCheckedChange={(newValue) => {
                  let newUrl = createHmDocLink_DEPRECATED({
                    documentId: unpackedRef?.id,
                    version: unpackedRef?.version,
                    blockRef: unpackedRef?.blockRef,
                    variants: unpackedRef?.variants,
                    latest: newValue != 'indeterminate' ? newValue : false,
                  })

                  console.log('== NEW URL', newValue)

                  props.editHyperlink(newUrl, props.text, true)
                }}
              />
              <Label htmlFor="link-latest" size="sm">
                Link to Latest Version
              </Label>
            </div>
          ) : null}
          <Tooltip content="Remove link">
            <Button size="iconSm" onClick={props.deleteHyperlink}>
              <Unlink className="size-4" />
            </Button>
          </Tooltip>
          <Tooltip content="Open in a new Window">
            <Button
              size="iconSm"
              onClick={() => props.openUrl(props.url, true)}
            >
              <ExternalLink className="size-4" />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
})
