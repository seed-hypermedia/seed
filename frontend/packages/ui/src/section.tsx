import {HTMLAttributes} from 'react'

export function Section({children, ...props}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="border-b border-border py-4" {...props}>
      {children}
    </div>
  )
}
