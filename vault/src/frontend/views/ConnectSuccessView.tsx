import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import * as navigation from '@/frontend/navigation'
import {CheckCircle2} from 'lucide-react'

/**
 * Shown after the desktop app has been linked with this vault.
 */
export function ConnectSuccessView() {
  const navigate = navigation.useHashNavigate()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-left text-xl">
          <CheckCircle2 className="size-6 text-green-600 dark:text-green-400" />
          Desktop app connected
        </CardTitle>
        <CardDescription className="text-left">Your Seed desktop app has been linked with this vault.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="bg-muted/40 space-y-2 rounded-lg border p-4 text-sm">
          <p>Go back to the Seed desktop app to continue — it finishes signing you in automatically.</p>
          <p className="text-muted-foreground">
            You can disconnect the desktop app later from its Vault Backend settings.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            className="w-full"
            onClick={() => {
              // The desktop app registers the hm:// scheme and hm://open
              // brings it to the front.
              window.location.href = 'hm://open'
            }}
          >
            Open desktop app
          </Button>
          <Button variant="outline" className="w-full" onClick={() => navigate('/')}>
            Manage my account
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
