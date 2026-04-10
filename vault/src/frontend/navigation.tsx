import * as React from 'react'
import * as ReactRouter from 'react-router-dom'

/** Adds the current hash fragment to a router target when the target does not specify one. */
export function withHash(to: ReactRouter.To): ReactRouter.To {
  if (typeof window === 'undefined' || !window.location.hash) {
    return to
  }

  if (typeof to === 'string') {
    return to.includes('#') ? to : `${to}${window.location.hash}`
  }

  if ('hash' in to) {
    return to
  }

  return {
    ...to,
    hash: window.location.hash,
  }
}

/** Returns a router navigate function that preserves the current hash fragment by default. */
export function useHashNavigate() {
  const navigate = ReactRouter.useNavigate()

  return React.useCallback(
    (to: ReactRouter.To | number, options?: ReactRouter.NavigateOptions) => {
      if (typeof to === 'number') {
        navigate(to)
        return
      }

      navigate(withHash(to), options)
    },
    [navigate],
  )
}

/** Redirect element that preserves the current hash fragment by default. */
export function HashNavigate(props: ReactRouter.NavigateProps) {
  return <ReactRouter.Navigate {...props} to={withHash(props.to)} />
}
