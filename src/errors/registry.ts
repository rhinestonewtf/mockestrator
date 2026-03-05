import type { Request } from 'express'

export type ErrorCategory =
  | 'auth'
  | 'validation'
  | 'token'
  | 'signature'
  | 'simulation'
  | 'state'
  | 'path'
  | 'infra'
  | 'parsing'

export type EndpointTarget =
  | 'portfolio'
  | 'intent_route'
  | 'intent_store'
  | 'intent_status'
  | '*'

export interface ErrorResponseBody {
  errors: Array<{
    message: string
    context?: Record<string, any>
  }>
  traceId?: string
}

export interface ErrorScenario {
  id: string
  label: string
  category: ErrorCategory
  statusCode: number
  endpoints: EndpointTarget[]
  response: ErrorResponseBody
  responseFactory?: (req: Request) => ErrorResponseBody
}
