import {zodResolver} from '@hookform/resolvers/zod'
import {useTxString} from '@shm/shared/translation'
import {useEffect} from 'react'
import {Control, useController, useForm} from 'react-hook-form'
import {z} from 'zod'
import {Button} from './button'
import {FormCheckbox, FormInput} from './form-input'
import {FormField} from './forms'
import {Spinner} from './spinner'
import {SizableText} from './text'

const emailNotificationsSchema = z.object({
  email: z.string().email(),
  notifyAllMentions: z.boolean(),
  notifyAllReplies: z.boolean(),
  notifyOwnedDocChange: z.boolean(),
  notifySiteDiscussions: z.boolean(),
})

export type UIEmailNotificationsFormSchema = z.infer<
  typeof emailNotificationsSchema
>

export function UIEmailNotificationsForm({
  onClose,
  onComplete,
  setEmailNotifications,
  isPending,
}: {
  onClose: () => void
  onComplete: (email: string) => void
  setEmailNotifications: (
    input: UIEmailNotificationsFormSchema,
  ) => Promise<void>
  isPending: boolean
}) {
  const tx = useTxString()
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<z.infer<typeof emailNotificationsSchema>>({
    resolver: zodResolver(emailNotificationsSchema),
    defaultValues: {
      email: '',
      notifyAllMentions: true,
      notifyAllReplies: true,
      notifyOwnedDocChange: true,
      notifySiteDiscussions: true,
    },
  })
  function onSubmit(data: z.infer<typeof emailNotificationsSchema>) {
    setEmailNotifications(data).then(() => {
      onComplete(data.email)
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
        <FormCheckbox
          name="notifySiteDiscussions"
          label={tx('Someone creates a discussion in my site')}
          control={control}
        />
      </div>
      <EmptyNotifWarning control={control} />
      <div className="flex gap-3 justify-end items-center">
        <Spinner hide={!isPending} />
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.preventDefault()
            onClose()
          }}
          disabled={isPending}
        >
          {tx('Cancel')}
        </Button>

        <Button variant="default" type="submit" disabled={isPending}>
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
  const {field: notifySiteDiscussions} = useController({
    control,
    name: 'notifySiteDiscussions',
  })
  if (
    notifyAllMentionsField.value ||
    notifyAllRepliesField.value ||
    notifyOwnedDocChangeField.value ||
    notifySiteDiscussions.value
  )
    return null
  return (
    <SizableText className="text-red-500">
      {tx('You will not receive any notifications.')}
    </SizableText>
  )
}

export function EmailNotificationsSuccess({
  email,
  onClose,
}: {
  email?: string | null
  onClose: () => void
}) {
  return (
    <>
      <SizableText>
        Email notifications have been set for{' '}
        <SizableText weight="bold">{email || 'your email'}</SizableText>.
      </SizableText>
      <SizableText>
        You can edit your notification preferences by clicking "Manage
        Notifications" from any email you receive.
      </SizableText>
      <Button variant="default" onClick={() => onClose()}>
        Done
      </Button>
    </>
  )
}
