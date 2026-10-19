import {zodResolver} from '@hookform/resolvers/zod'
import {useTxString} from '@shm/shared/translation'
import {useEffect, useRef, useState} from 'react'
import {Control, FieldValues, Path, useController, useForm} from 'react-hook-form'
import {z} from 'zod'
import {Button} from './button'
import {Field} from './form-fields'
import {FormError, FormInput} from './form-input'
import {getDaemonFileUrl} from './get-file-url'
import {useImageCropper, type ImageCropConfig} from './image-crop-dialog'
import {AVATAR_IMAGE_POLICY, IMAGE_FILE_ACCEPT, processImage} from './image-processing'
import {SizableText} from './text'

export const siteMetaSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  icon: z.string().or(z.instanceof(Blob)).nullable(),
  description: z.string().optional(),
})
export type SiteMetaFields = z.infer<typeof siteMetaSchema>

export function EditProfileForm({
  onSubmit,
  defaultValues,
  submitLabel,
}: {
  onSubmit: (data: SiteMetaFields) => void
  defaultValues?: SiteMetaFields
  submitLabel?: string
}) {
  const tx = useTxString()
  const form = useForm<SiteMetaFields>({
    resolver: zodResolver(siteMetaSchema),
    defaultValues: defaultValues || {
      name: '',
      icon: null,
      description: '',
    },
  })
  useEffect(() => {
    setTimeout(() => {
      form.setFocus('name', {shouldSelect: true})
    }, 300) // wait for animation
  }, [form.setFocus])
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <div className="flex flex-col gap-2">
        <Field id="name" label={tx('Account Name')}>
          <FormInput control={form.control} name="name" placeholder={tx('My New Public Name')} />
          <FormError errors={form.formState.errors} name="name" />
        </Field>
        <Field id="icon" label={tx('Profile Icon')}>
          <ImageField
            control={form.control}
            name="icon"
            label={tx('Profile Icon')}
            crop={{aspect: 1, cropShape: 'round', maxDimension: 512} as ImageCropConfig}
          />
        </Field>
        <div>
          <Button type="submit" variant="default" size="lg" className={`w-full`}>
            {submitLabel || tx('Save')}
          </Button>
        </div>
      </div>
    </form>
  )
}

function ImageField<Fields extends FieldValues>({
  control,
  name,
  label,
  crop,
}: {
  control: Control<Fields>
  name: Path<Fields>
  label: string
  crop?: ImageCropConfig
}) {
  const c = useController({control, name})
  const cropper = useImageCropper({crop, onCropped: (file) => c.field.onChange(file)})
  const tx = useTxString()
  const [currentImgURL, setCurrentImgURL] = useState<string | null>(null)
  const [imageError, setImageError] = useState('')
  const [processing, setProcessing] = useState(false)
  const requestRef = useRef(0)
  useEffect(() => {
    const value = c.field.value
    const url = value ? (typeof value === 'string' ? getDaemonFileUrl(value) : URL.createObjectURL(value)) : null
    setCurrentImgURL(url)
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [c.field.value])
  useEffect(() => () => void requestRef.current++, [])
  return (
    <div className="flex flex-col gap-1">
      <div className="group relative flex h-[128px] w-[128px] cursor-pointer overflow-hidden rounded-sm border-2 border-dashed border-neutral-300 hover:border-neutral-400 max-sm:h-16 max-sm:w-16 dark:border-neutral-600 dark:hover:border-neutral-500">
        <input
          type="file"
          accept={IMAGE_FILE_ACCEPT}
          disabled={processing}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            const request = ++requestRef.current
            setImageError('')
            if (cropper.pick(file)) return
            setProcessing(true)
            try {
              const blob = await processImage(file, AVATAR_IMAGE_POLICY)
              if (request !== requestRef.current) return
              c.field.onChange(blob)
            } catch (error) {
              if (request === requestRef.current) {
                setImageError(error instanceof Error ? error.message : 'Could not process this image')
              }
            } finally {
              if (request === requestRef.current) setProcessing(false)
            }
          }}
          className="absolute inset-0 z-10 cursor-pointer opacity-0"
        />
        {!c.field.value && (
          <div className="pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center bg-neutral-100 dark:bg-neutral-800">
            <SizableText size="xs" className="text-center text-neutral-600 dark:text-neutral-400">
              {tx('add', ({what}: {what: string}) => `Add ${what}`, {
                what: label,
              })}
            </SizableText>
          </div>
        )}
        {c.field.value && (
          <img src={currentImgURL || undefined} alt={label} className="absolute inset-0 h-full w-full object-cover" />
        )}
        {c.field.value && (
          <div className="pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <SizableText size="xs" className="text-center text-white">
              Edit {label}
            </SizableText>
          </div>
        )}
      </div>
      {cropper.dialog}
      {imageError ? <p className="text-destructive max-w-48 text-xs">{imageError}</p> : null}
    </div>
  )
}
