import type { ErrorScenario } from '../registry'

export const parsingScenarios: ErrorScenario[] = [
  {
    id: 'parsing.invalid-bundle-structure',
    label: 'Invalid bundle structure',
    category: 'parsing',
    statusCode: 400,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'Invalid bundle structure' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'parsing.invalid-712-types',
    label: 'Invalid EIP-712 types',
    category: 'parsing',
    statusCode: 400,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'Invalid 712 types' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'parsing.serialization-failure',
    label: 'Serialization failure',
    category: 'parsing',
    statusCode: 400,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'Serialization failure' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'parsing.body-parse-failed',
    label: 'Body parse failed',
    category: 'parsing',
    statusCode: 400,
    endpoints: ['*'],
    response: { errors: [{ message: 'Unexpected token in JSON' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'parsing.zod-validation',
    label: 'Zod validation error',
    category: 'parsing',
    statusCode: 422,
    endpoints: ['*'],
    response: {
      errors: [{ message: 'Required', context: { path: 'body.field' } }],
      traceId: 'mock-trace-000',
    },
  },
]
