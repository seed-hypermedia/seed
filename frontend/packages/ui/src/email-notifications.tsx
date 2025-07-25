import {zodResolver} from '@hookform/resolvers/zod'
import {useTxString} from '@shm/shared/translation'
import {FormCheckbox, FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {Spinner} from '@shm/ui/spinner'
import {useEffect} from 'react'
import {Control, useController, useForm} from 'react-hook-form'
import {z} from 'zod'
import {Button} from './button'
import {SizableText} from './text'

const emailNotificationsSchema = z.object({
  email: z.string().email(),
  notifyAllMentions: z.boolean(),
  notifyAllReplies: z.boolean(),
  notifyOwnedDocChange: z.boolean(),
})

export type UIEmailNotificationsFormSchema = z.infer<
  typeof emailNotificationsSchema
>

export function UIEmailNotificationsForm({
  onClose,
  onComplete,
  defaultValues,
  setEmailNotifications,
  isLoading,
}: {
  onClose: () => void
  onComplete: () => void
  defaultValues?: z.infer<typeof emailNotificationsSchema>
  setEmailNotifications: (
    input: UIEmailNotificationsFormSchema,
  ) => Promise<void>
  isLoading: boolean
}) {
  const tx = useTxString()
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<z.infer<typeof emailNotificationsSchema>>({
    resolver: zodResolver(emailNotificationsSchema),
    defaultValues: defaultValues || {
      email: '',
      notifyAllMentions: true,
      notifyAllReplies: true,
      notifyOwnedDocChange: true,
    },
  })
  function onSubmit(data: z.infer<typeof emailNotificationsSchema>) {
    console.log('data', data)
    setEmailNotifications(data).then(() => {
      // onClose()
      onComplete()
    })
  }
  useEffect(() => {
    setFocus('email')
  }, [setFocus])
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FormField
        name="email"
        label={tx('Notification Email')}
        errors={errors}
        className="mx-0"
      >
        <FormInput
          name="email"
          control={control}
          placeholder="me@example.com"
        />
      </FormField>
      <div className="flex flex-col gap-3">
        <SizableText>{tx('Notify me when')}:</SizableText>
        <FormCheckbox
          name="notifyAllMentions"
          label={tx('Someone mentions me')}
          control={control}
        />
        <FormCheckbox
          name="notifyAllReplies"
          label={tx('Someone replies to me')}
          control={control}
        />
        <FormCheckbox
          name="notifyOwnedDocChange"
          label={tx('Someone changes a document I own')}
          control={control}
        />
      </div>
      <EmptyNotifWarning control={control} />
      <div className="flex items-center justify-end gap-3">
        <Spinner hide={!isLoading} />
        <Button
          variant="ghost"
          size="sm"
          type="button" // Prevent form submission
          onClick={() => {
            onClose()
          }}
        >
          {tx('Cancel')}
        </Button>

        <Button variant="default" type="submit">
          {tx('Save Notification Settings')}
        </Button>
      </div>
    </form>
  )
}

function EmptyNotifWarning({
  control,
}: {
  control: Control<z.infer<typeof emailNotificationsSchema>>
}) {
  const tx = useTxString()
  const {field: notifyAllMentionsField} = useController({
    control,
    name: 'notifyAllMentions',
  })
  const {field: notifyAllRepliesField} = useController({
    control,
    name: 'notifyAllReplies',
  })
  const {field: notifyOwnedDocChangeField} = useController({
    control,
    name: 'notifyOwnedDocChange',
  })
  if (
    notifyAllMentionsField.value ||
    notifyAllRepliesField.value ||
    notifyOwnedDocChangeField.value
  )
    return null
  return (
    <SizableText className="text-red-500">
      {tx('You will not receive any notifications.')}
    </SizableText>
  )
}
