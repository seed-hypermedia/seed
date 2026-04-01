/** Footer for the vault application shell. */
export function AppFooter({notificationServerUrl}: {notificationServerUrl: string}) {
  if (!notificationServerUrl) {
    return null
  }

  return (
    <footer className="border-t px-4 py-3 md:px-8">
      <div className="text-muted-foreground mx-auto flex w-full max-w-5xl flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <span className="font-medium tracking-wide uppercase">Notification server URL</span>
        <a
          href={notificationServerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-foreground font-mono break-all"
        >
          {notificationServerUrl}
        </a>
      </div>
    </footer>
  )
}
