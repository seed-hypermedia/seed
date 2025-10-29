import {HMMetadataPayload, useRouteLink} from '@shm/shared'
import {useTxString} from '@shm/shared/translation'
import {ExternalLink, Pencil} from 'lucide-react'
import {Button} from './button'
import {Feed} from './feed'
import {HMIcon} from './hm-icon'

export function HMProfilePage({
  profile,
  currentAccount,
  onEditProfile,
  headerButtons,
}: {
  profile: HMMetadataPayload
  onEditProfile: (() => void) | null
  currentAccount?: string
  headerButtons?: React.ReactNode
}) {
  const tx = useTxString()
  return (
    <div>
      <div className="mx-auto max-w-4xl">
        <ProfileHeader
          profile={profile}
          onEditProfile={onEditProfile}
          currentAccount={currentAccount}
          buttons={headerButtons}
        />
        <div className="border-t border-neutral-200 py-6 dark:border-neutral-800">
          <h2 className="text-2xl font-bold">{tx('Account Activity')}</h2>
        </div>
        <Feed
          currentAccount={currentAccount}
          filterAuthors={[profile.id.uid]}
          commentEditor={null}
          filterResource={undefined}
        />
      </div>
    </div>
  )
}

function ProfileHeader({
  profile,
  onEditProfile,
  currentAccount,
  buttons,
}: {
  profile: HMMetadataPayload
  onEditProfile: (() => void) | null
  currentAccount?: string
  buttons?: React.ReactNode
}) {
  const isCurrentAccount = currentAccount === profile.id.uid
  const tx = useTxString()
  const siteLinkProps = useRouteLink({key: 'document', id: profile.id})
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-7">
      <div className="flex items-center gap-4">
        <HMIcon
          id={profile.id}
          size={100}
          icon={profile.metadata?.icon}
          name={profile.metadata?.name}
        />
        <div className="flex flex-col gap-2">
          <h2 className="text-4xl font-bold">
            {tx('about_account', ({name}) => `${name}`, {
              name: profile.metadata?.name ?? tx('Unknown Profile'),
            })}
          </h2>
          {profile.metadata?.siteUrl ? (
            <a
              href={profile.metadata?.siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              {profile.metadata?.siteUrl}
              <ExternalLink className="size-4" />
            </a>
          ) : (
            profile.hasSite && (
              <a {...siteLinkProps} className="flex items-center gap-2">
                Open Site
                <ExternalLink className="size-4" />
              </a>
            )
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onEditProfile && isCurrentAccount && (
          <Button variant="outline" onClick={onEditProfile}>
            <Pencil className="size-4" /> Edit
          </Button>
        )}
        {buttons}
      </div>
    </div>
  )
}
