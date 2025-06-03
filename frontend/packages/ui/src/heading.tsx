import React, {HTMLAttributes, useCallback} from 'react'

interface SeedHeadingProps
  extends Omit<HTMLAttributes<HTMLHeadingElement>, 'level'> {
  level?: 1 | 2 | 3 | 4
  children: React.ReactNode
}

export const SeedHeading = React.forwardRef<
  HTMLHeadingElement,
  SeedHeadingProps
>(({level = 2, className = '', children, ...props}, ref) => {
  const getHeadingClasses = useCallback(() => {
    const baseClasses = 'font-bold'

    switch (level) {
      case 1:
        return `${baseClasses} text-xl leading-7 md:text-2xl md:leading-8 lg:text-3xl lg:leading-9`
      case 2:
        return `${baseClasses} text-lg leading-6 md:text-xl md:leading-7 lg:text-2xl lg:leading-8`
      case 3:
        return `${baseClasses} text-md leading-6 md:text-lg md:leading-7 lg:text-xl lg:leading-8`
      case 4:
        return `${baseClasses} text-sm leading-6 md:text-md md:leading-7 lg:text-lg lg:leading-8`
      default:
        return `${baseClasses} text-lg leading-6 md:text-xl md:leading-7 lg:text-2xl lg:leading-8`
    }
  }, [level])

  const combinedClasses = `${getHeadingClasses()} ${className}`.trim()

  switch (level) {
    case 1:
      return (
        <h2
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={combinedClasses}
          {...props}
        >
          {children}
        </h2>
      )
    case 2:
      return (
        <h3
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={combinedClasses}
          {...props}
        >
          {children}
        </h3>
      )
    case 3:
      return (
        <h4
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={combinedClasses}
          {...props}
        >
          {children}
        </h4>
      )
    case 4:
      return (
        <h5
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={combinedClasses}
          {...props}
        >
          {children}
        </h5>
      )
    default:
      return (
        <h2
          ref={ref as React.Ref<HTMLHeadingElement>}
          className={combinedClasses}
          {...props}
        >
          {children}
        </h2>
      )
  }
})
