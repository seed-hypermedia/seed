import {useTx} from '@shm/shared/translation'
import {SizableText} from '@shm/ui/text'
import {SiteDocumentPayload} from './loaders'
import {PageFooter} from './page-footer'

export function NotFoundPage({id}: SiteDocumentPayload) {
  const tx = useTx()
  return (
    <div className="flex flex-col w-screen h-screen">
      <div className="flex flex-1 justify-center items-start px-4 py-12">
        <div className="flex flex-col flex-1 gap-4 p-6 w-full max-w-lg bg-white rounded-lg border shadow-lg border-border flex-0 dark:bg-background">
          <SizableText size="3xl">☹️</SizableText>
          <SizableText size="2xl" weight="bold">
            {tx('Document Not Found')}
          </SizableText>

          <SizableText asChild>
            <p>
              {tx(
                'oops_document_not_found',
                `Oops! The document you're looking for doesn't seem to exist. It
              may have been moved, deleted, or the link might be incorrect.`,
              )}
            </p>
          </SizableText>
          <SizableText asChild>
            <p>
              {tx(
                'please_double_check_url',
                `Please double-check the URL or head back to the dashboard to find
              what you're looking for. If you need help, feel free to reach out
              to support.`,
              )}
            </p>
          </SizableText>
        </div>
      </div>
      <PageFooter id={id} />
    </div>
  )
}
