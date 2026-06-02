declare module '*.svg' {
  const path: `${string}.svg`
  export = path
}

declare module '*.css' {
  const css: string
  export default css
}

declare module '*.module.css' {
  const classes: {readonly [key: string]: string}
  export = classes
}

declare module '*.sql' {
  const sql: string
  export default sql
}
