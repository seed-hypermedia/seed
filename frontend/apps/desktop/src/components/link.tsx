import {NavRoute} from '@shm/shared/routes'
import {ComponentProps} from 'react'
import {ButtonText} from 'tamagui'
import {useNavigate} from '../utils/useNavigate'

export function AppLinkText({
  toRoute,
  ...props
}: ComponentProps<typeof ButtonText> & {toRoute: NavRoute}) {
  const navigate = useNavigate()
  return (
    <ButtonText
      {...props}
      onPress={() => {
        navigate(toRoute)
      }}
    />
  )
}
