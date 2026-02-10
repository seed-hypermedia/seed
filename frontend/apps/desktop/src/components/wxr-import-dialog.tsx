/**
 * WordPress WXR Import Dialog Component.
 * Provides a multi-step UI for importing WordPress exports.
 */
import {useMyAccountsWithWriteAccess} from '@/models/access-control'
import {client} from '@/trpc'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {Button} from '@shm/ui/button'
import {CheckboxField} from '@shm/ui/components/checkbox'
import {
  DialogClose,
  DialogDescription,
  DialogTitle,
} from '@shm/ui/components/dialog'
import {Label} from '@shm/ui/components/label'
import {RadioGroup, RadioGroupItem} from '@shm/ui/components/radio-group'
import {HMIcon} from '@shm/ui/hm-icon'
import {Upload} from '@shm/ui/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shm/ui/select-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useEffect, useState} from 'react'
import type {ImportResults} from '../wxr-import'

export function useWXRImportDialog() {
  return useAppDialog(WXRImportDialog)
}

interface WXRImportDialogInput {
  destinationId: UnpackedHypermediaId
}

type ImportStep = 'upload' | 'preview' | 'options' | 'importing' | 'complete'

function WXRImportDialog({
  input,
  onClose,
}: {
  input: WXRImportDialogInput
  onClose: () => void
}) {
  const [step, setStep] = useState<ImportStep>('upload')
  const [wxrContent, setWxrContent] = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<{
    siteTitle: string
    siteUrl: string
    authorCount: number
    postCount: number
    pageCount: number
    authors: Array<{login: string; displayName: string; email: string}>
    authoredFallbackAuthors: Array<{
      login: string
      displayName: string
      email: string
      reason: 'missing_email' | 'missing_author_profile'
    }>
  } | null>(null)
  const [importMode, setImportMode] = useState<'ghostwritten' | 'authored'>(
    'ghostwritten',
  )
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [overwriteExisting, setOverwriteExisting] = useState(false)
  const [importResults, setImportResults] = useState<ImportResults | null>(null)

  const accounts = useMyAccountsWithWriteAccess(input.destinationId)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedAccount && accounts[0]?.data?.id.uid) {
      setSelectedAccount(accounts[0].data?.id.uid)
    }
  }, [selectedAccount, accounts])

  const parseWXR = useMutation({
    mutationFn: (content: string) =>
      client.webImporting.wxrParseFile.mutate(content),
    onSuccess: (result) => {
      setParseResult(result)
      setStep('preview')
    },
    onError: (error: Error) => {
      toast.error(`Failed to parse WXR file: ${error.message}`)
    },
  })

  const startImport = useMutation({
    mutationFn: (params: {
      wxrContent: string
      destinationUid: string
      destinationPath: string[]
      publisherKeyName: string
      mode: 'ghostwritten' | 'authored'
      password?: string
      overwriteExisting?: boolean
    }) => client.webImporting.wxrStartImport.mutate(params),
    onSuccess: () => {
      setStep('importing')
    },
    onError: (error: Error) => {
      toast.error(`Failed to start import: ${error.message}`)
    },
  })

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    const content = await file.text()
    setWxrContent(content)
    parseWXR.mutate(content)
  }

  const handleStartImport = () => {
    if (!wxrContent || !selectedAccount) return

    startImport.mutate({
      wxrContent,
      destinationUid: input.destinationId.uid,
      destinationPath: input.destinationId.path || [],
      publisherKeyName: selectedAccount,
      mode: importMode,
      password: importMode === 'authored' ? password : undefined,
      overwriteExisting,
    })
  }

  return (
    <>
      <DialogClose />
      {step === 'upload' && (
        <UploadStep
          onFileUpload={handleFileUpload}
          isLoading={parseWXR.isPending}
        />
      )}
      {step === 'preview' && parseResult && (
        <PreviewStep
          result={parseResult}
          onContinue={() => setStep('options')}
          onBack={() => setStep('upload')}
        />
      )}
      {step === 'options' && (
        <OptionsStep
          importMode={importMode}
          setImportMode={setImportMode}
          password={password}
          setPassword={setPassword}
          confirmPassword={confirmPassword}
          setConfirmPassword={setConfirmPassword}
          overwriteExisting={overwriteExisting}
          setOverwriteExisting={setOverwriteExisting}
          accounts={accounts}
          selectedAccount={selectedAccount}
          setSelectedAccount={setSelectedAccount}
          authoredFallbackAuthors={parseResult?.authoredFallbackAuthors || []}
          onStart={handleStartImport}
          onBack={() => {
            setPassword('')
            setConfirmPassword('')
            setStep('preview')
          }}
          isLoading={startImport.isPending}
        />
      )}
      {step === 'importing' && (
        <ImportingStep
          onComplete={(results) => {
            setImportResults(results)
            setStep('complete')
          }}
        />
      )}
      {step === 'complete' && (
        <CompleteStep onClose={onClose} results={importResults} />
      )}
    </>
  )
}

function UploadStep({
  onFileUpload,
  isLoading,
}: {
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  isLoading: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Import WordPress Export (WXR)</DialogTitle>
      <DialogDescription>
        Upload a WordPress export file (.xml) to import posts and pages.
      </DialogDescription>
      <div className="flex flex-col items-center gap-4 py-8">
        {isLoading ? (
          <>
            <Spinner size="small" />
            <SizableText>Parsing WXR file...</SizableText>
          </>
        ) : (
          <>
            <Upload className="text-muted-foreground size-12" />
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".xml"
                onChange={onFileUpload}
                className="hidden"
              />
              <Button variant="outline" asChild>
                <span>Select WXR File</span>
              </Button>
            </label>
            <SizableText size="sm" color="muted">
              WordPress export files are typically named export.xml or similar
            </SizableText>
          </>
        )}
      </div>
    </div>
  )
}

function PreviewStep({
  result,
  onContinue,
  onBack,
}: {
  result: {
    siteTitle: string
    siteUrl: string
    authorCount: number
    postCount: number
    pageCount: number
    authors: Array<{login: string; displayName: string; email: string}>
    authoredFallbackAuthors: Array<{
      login: string
      displayName: string
      email: string
      reason: 'missing_email' | 'missing_author_profile'
    }>
  }
  onContinue: () => void
  onBack: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Preview Import</DialogTitle>
      <DialogDescription>
        Review the content that will be imported from {result.siteTitle}.
      </DialogDescription>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex justify-between">
          <SizableText color="muted">Site</SizableText>
          <SizableText>{result.siteTitle}</SizableText>
        </div>
        <div className="flex justify-between">
          <SizableText color="muted">URL</SizableText>
          <SizableText>{result.siteUrl}</SizableText>
        </div>
        <div className="flex justify-between">
          <SizableText color="muted">Posts</SizableText>
          <SizableText>{result.postCount}</SizableText>
        </div>
        <div className="flex justify-between">
          <SizableText color="muted">Pages</SizableText>
          <SizableText>{result.pageCount}</SizableText>
        </div>
        <div className="flex justify-between">
          <SizableText color="muted">Authors</SizableText>
          <SizableText>{result.authorCount}</SizableText>
        </div>
      </div>

      {result.authors.length > 0 && (
        <div className="space-y-2">
          <SizableText weight="bold">Authors</SizableText>
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {result.authors.map((author) => (
              <div key={author.login} className="flex items-center gap-2">
                <SizableText>{author.displayName}</SizableText>
                <SizableText size="sm" color="muted">
                  ({author.email})
                </SizableText>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onContinue}>Continue</Button>
      </div>
    </div>
  )
}

function OptionsStep({
  importMode,
  setImportMode,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  overwriteExisting,
  setOverwriteExisting,
  accounts,
  selectedAccount,
  setSelectedAccount,
  authoredFallbackAuthors,
  onStart,
  onBack,
  isLoading,
}: {
  importMode: 'ghostwritten' | 'authored'
  setImportMode: (mode: 'ghostwritten' | 'authored') => void
  password: string
  setPassword: (password: string) => void
  confirmPassword: string
  setConfirmPassword: (password: string) => void
  overwriteExisting: boolean
  setOverwriteExisting: (value: boolean) => void
  accounts: any[]
  selectedAccount: string | null
  setSelectedAccount: (account: string) => void
  authoredFallbackAuthors: Array<{
    login: string
    displayName: string
    email: string
    reason: 'missing_email' | 'missing_author_profile'
  }>
  onStart: () => void
  onBack: () => void
  isLoading: boolean
}) {
  const [showFallbackAuthors, setShowFallbackAuthors] = useState(
    () => authoredFallbackAuthors.length <= 2,
  )

  useEffect(() => {
    setShowFallbackAuthors(authoredFallbackAuthors.length <= 2)
  }, [authoredFallbackAuthors.length])

  const passwordsMatch = password === confirmPassword
  const showPasswordError =
    importMode === 'authored' && confirmPassword.length > 0 && !passwordsMatch

  const canStart =
    !isLoading &&
    selectedAccount &&
    (importMode === 'ghostwritten' ||
      (password.length > 0 && confirmPassword.length > 0 && passwordsMatch))

  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Import Options</DialogTitle>
      <DialogDescription>
        Configure how the content should be imported.
      </DialogDescription>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Label>Signing Account</Label>
          {selectedAccount && (
            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select Account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => {
                  const id = a.data?.id
                  if (!id) return null
                  return (
                    <SelectItem key={id.uid} value={id.uid}>
                      <div className="flex items-center gap-2">
                        <HMIcon
                          size={24}
                          id={id}
                          // @ts-expect-error - metadata type mismatch
                          metadata={a.data?.document?.metadata}
                        />
                        {a.data?.document?.metadata?.name || ''}
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Label>Import Mode</Label>
          <RadioGroup
            value={importMode}
            onValueChange={(v) =>
              setImportMode(v as 'ghostwritten' | 'authored')
            }
            className="flex flex-col gap-3"
          >
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="ghostwritten"
                id="mode-ghostwritten"
                className="mt-0.5"
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="mode-ghostwritten" className="cursor-pointer">
                  Ghostwritten
                </Label>
                <span className="text-muted-foreground text-xs">
                  Publisher signs all content, authors shown as display names
                </span>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="authored"
                id="mode-authored"
                className="mt-0.5"
                disabled
              />
              <div className="flex flex-col gap-1 opacity-50">
                <Label htmlFor="mode-authored" className="cursor-not-allowed">
                  Authored
                </Label>
                <span className="text-muted-foreground text-xs">
                  Generate keys for each author (temporarily unavailable)
                </span>
              </div>
            </div>
          </RadioGroup>
        </div>

        {importMode === 'authored' && (
          <div className="flex flex-col gap-3">
            <Label>Author Keys Password</Label>
            <SizableText size="xs" color="muted">
              Encrypts the author keys file. Share this password with authors so
              they can import their identity, or use it to load keys into a site
              vault.
            </SizableText>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              placeholder="Confirm password"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            {showPasswordError && (
              <SizableText size="xs" color="destructive">
                Passwords do not match
              </SizableText>
            )}

            {authoredFallbackAuthors.length > 0 && (
              <div className="bg-muted/30 border-border rounded-md border p-3">
                <SizableText size="xs" weight="bold">
                  Some writers are missing author profile metadata.
                </SizableText>
                <SizableText size="xs" color="muted">
                  These posts will be publisher-signed and keep writer credit
                  via displayAuthor.
                </SizableText>
                <button
                  type="button"
                  className="text-muted-foreground mt-2 text-left text-xs underline underline-offset-2"
                  onClick={() =>
                    setShowFallbackAuthors((expanded) => !expanded)
                  }
                >
                  {showFallbackAuthors ? 'Hide' : 'Show'} affected writers (
                  {authoredFallbackAuthors.length})
                </button>
                {showFallbackAuthors && (
                  <div className="mt-2 space-y-1">
                    {authoredFallbackAuthors.map((author) => (
                      <SizableText key={author.login} size="xs" color="muted">
                        {author.displayName} ({author.login}) -{' '}
                        {author.reason === 'missing_email'
                          ? 'missing email'
                          : 'missing author profile'}
                      </SizableText>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <CheckboxField
            id="overwrite-existing"
            checked={overwriteExisting}
            onCheckedChange={setOverwriteExisting}
          >
            Overwrite existing documents at same path
          </CheckboxField>
          <SizableText size="xs" color="muted" className="ml-7">
            When unchecked, documents that already exist will be skipped
          </SizableText>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onStart} disabled={!canStart}>
          {isLoading ? <Spinner size="small" /> : 'Start Import'}
        </Button>
      </div>
    </div>
  )
}

function ImportingStep({
  onComplete,
}: {
  onComplete: (results: ImportResults | null) => void
}) {
  const {data: status} = useQuery({
    queryKey: ['WXR_IMPORT_STATUS'],
    queryFn: () => client.webImporting.wxrGetStatus.query(),
    refetchInterval: 500,
  })

  useEffect(() => {
    if (status?.status?.phase === 'complete') {
      // Results are stored in the import state
      onComplete(status?.status?.results || null)
    }
  }, [status?.status?.phase, onComplete, status?.status])

  const progress = status?.status
  const percent =
    progress && progress.totalPosts > 0
      ? Math.round((progress.importedPosts / progress.totalPosts) * 100)
      : 0

  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Importing...</DialogTitle>
      <DialogDescription>
        Please wait while your content is being imported.
      </DialogDescription>

      <div className="flex flex-col items-center gap-4 py-8">
        <Spinner size="small" />

        {progress && (
          <>
            <div className="h-2 w-full rounded-full bg-gray-200">
              <div
                className="h-2 rounded-full bg-blue-600 transition-all"
                style={{width: `${percent}%`}}
              />
            </div>
            <SizableText>
              {progress.importedPosts} / {progress.totalPosts} posts imported
            </SizableText>
            <SizableText size="sm" color="muted">
              Phase: {progress.phase}
            </SizableText>
          </>
        )}

        {progress?.error && (
          <SizableText color="destructive">Error: {progress.error}</SizableText>
        )}
      </div>
    </div>
  )
}

const MAX_DISPLAY_ITEMS = 5

function CompleteStep({
  onClose,
  results,
}: {
  onClose: () => void
  results: ImportResults | null
}) {
  const {data: statusData} = useQuery({
    queryKey: ['WXR_IMPORT_STATUS'],
    queryFn: () => client.webImporting.wxrGetStatus.query(),
  })
  const canExportAuthorKeys = !!statusData?.canExportAuthorKeys

  const exportAuthorKeysMutation = useMutation({
    mutationFn: () => client.webImporting.wxrExportAuthorKeys.mutate({}),
    onSuccess: (result) => {
      if (!result.saved) return
      toast.success(`Author keys exported to ${result.filePath}`)
    },
    onError: (error) => {
      toast.error(
        `Failed to export author keys file: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    },
  })

  const hasSkipped = results && results.skipped.length > 0
  const hasFailed = results && results.failed.length > 0
  const allSuccessful = !hasSkipped && !hasFailed

  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Import Complete</DialogTitle>
      <DialogDescription>
        {allSuccessful
          ? 'Your WordPress content has been successfully imported.'
          : 'Import finished with some items skipped or failed.'}
      </DialogDescription>

      <div className="flex flex-col gap-4 py-4">
        {/* Success count */}
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-green-100">
            <span className="text-sm text-green-600">&#10003;</span>
          </div>
          <SizableText>
            {results?.imported || 0} document
            {results?.imported !== 1 ? 's' : ''} imported
          </SizableText>
        </div>

        {/* Skipped items */}
        {hasSkipped && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-yellow-100">
                <span className="text-sm text-yellow-600">&#8722;</span>
              </div>
              <SizableText>
                {results.skipped.length} document
                {results.skipped.length !== 1 ? 's' : ''} skipped (already
                exist)
              </SizableText>
            </div>
            <div className="ml-11 space-y-1">
              {results.skipped.slice(0, MAX_DISPLAY_ITEMS).map((item, i) => (
                <SizableText key={i} size="xs" color="muted">
                  /{item.path.join('/')} - {item.title}
                </SizableText>
              ))}
              {results.skipped.length > MAX_DISPLAY_ITEMS && (
                <SizableText size="xs" color="muted">
                  ...and {results.skipped.length - MAX_DISPLAY_ITEMS} more
                </SizableText>
              )}
            </div>
          </div>
        )}

        {/* Failed items */}
        {hasFailed && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-full bg-red-100">
                <span className="text-sm text-red-600">&#10005;</span>
              </div>
              <SizableText>
                {results.failed.length} document
                {results.failed.length !== 1 ? 's' : ''} failed
              </SizableText>
            </div>
            <div className="ml-11 space-y-1">
              {results.failed.slice(0, MAX_DISPLAY_ITEMS).map((item, i) => (
                <div key={i}>
                  <SizableText size="xs" color="muted">
                    /{item.path.join('/')} - {item.title}
                  </SizableText>
                  <SizableText size="xs" color="destructive">
                    {item.error}
                  </SizableText>
                </div>
              ))}
              {results.failed.length > MAX_DISPLAY_ITEMS && (
                <SizableText size="xs" color="muted">
                  ...and {results.failed.length - MAX_DISPLAY_ITEMS} more
                </SizableText>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {canExportAuthorKeys && (
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => exportAuthorKeysMutation.mutate()}
            disabled={exportAuthorKeysMutation.isLoading}
          >
            {exportAuthorKeysMutation.isLoading
              ? 'Exporting...'
              : 'Export Author Keys'}
          </Button>
        )}
        <Button
          onClick={onClose}
          className={canExportAuthorKeys ? 'flex-1' : 'w-full'}
        >
          Done
        </Button>
      </div>
    </div>
  )
}
