export function ResizeHandle() {
  return (
    <div
      className="border-border bg-color absolute h-8 w-2 cursor-col-resize rounded-sm border hover:cursor-col-resize"
      style={{top: 'calc(50% - 16px)'}}
    />
  )
}
