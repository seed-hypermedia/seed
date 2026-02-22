export class SeedClientError extends Error {
  readonly status: number
  readonly body?: string

  constructor(message: string, status: number, body?: string) {
    super(message)
    this.name = 'SeedClientError'
    this.status = status
    this.body = body
  }
}

export class SeedNetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SeedNetworkError'
  }
}

export class SeedValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedValidationError'
  }
}
