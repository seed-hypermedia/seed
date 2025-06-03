export function OnlineIndicator({online}: {online: boolean}) {
  return (
    <div className="flex items-center justify-center w-5">
      <div
        className={`size-2 rounded-full ${
          online ? 'bg-green-600' : 'bg-gray-800'
        }`}
      />
    </div>
  )
}
