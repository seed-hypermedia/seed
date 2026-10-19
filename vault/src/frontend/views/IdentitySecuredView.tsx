import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent} from '@/frontend/components/ui/card'
import * as navigation from '@/frontend/navigation'
import {Check} from 'lucide-react'

/**
 * Success screen shown after the account is secured with a password.
 */
export function IdentitySecuredView() {
  const navigate = navigation.useHashNavigate()

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="bg-brand/15 flex size-14 items-center justify-center rounded-full">
          <Check className="text-brand size-7" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold">Your identity is secured</h2>
          <p className="text-muted-foreground text-sm">
            Your password has been set and your recovery words have been generated.
          </p>
        </div>
        <Button className="w-full" onClick={() => navigate('/profile/create')}>
          Continue
        </Button>
      </CardContent>
    </Card>
  )
}
