import {HTMLAttributes} from 'react'

export function Section({children, ...props}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="border-border border-b py-4" {...props}>
      {children}
    </div>
  )
}
