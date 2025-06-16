import {SizableText} from '@shm/ui/text'
import {SiteDocumentPayload} from './loaders'
import {PageFooter} from './page-footer'

export function NotFoundPage({id}: SiteDocumentPayload) {
  return (
    <div className="h-screen w-screen flex flex-col">
      <div className="flex-1 justify-center flex items-start py-12 px-4">
        <div className="flex flex-col gap-4 flex-1 w-full max-w-lg p-6 rounded-lg border border-border flex-0 bg-white dark:bg-background shadow-lg">
          <SizableText size="3xl">☹️</SizableText>
          <SizableText size="2xl" weight="bold">
            Document Not Found
          </SizableText>

          <SizableText asChild>
            <p>
              Oops! The document you're looking for doesn't seem to exist. It
              may have been moved, deleted, or the link might be incorrect.
            </p>
          </SizableText>
          <SizableText asChild>
            <p>
              Please double-check the URL or head back to the dashboard to find
              what you're looking for. If you need help, feel free to reach out
              to support.
            </p>
          </SizableText>
        </div>
      </div>
      <PageFooter id={id} />
    </div>
  )
}
