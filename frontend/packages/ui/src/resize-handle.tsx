export function ResizeHandle({
  onMouseDown,
  style,
  ...props
}: React.HTMLProps<HTMLDivElement>) {
  return (
    <div
      className="border-border bg-foreground absolute z-[7] h-12 w-2 cursor-col-resize rounded-md border"
      style={{top: 'calc(50% - 16px)', ...style}}
      onMouseDown={onMouseDown}
      {...props}
    />
  )
}
