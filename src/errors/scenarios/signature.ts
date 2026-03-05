import type { ErrorScenario } from '../registry'

export const signatureScenarios: ErrorScenario[] = [
  {
    id: 'signature.invalid-bundle',
    label: 'Invalid bundle signature',
    category: 'signature',
    statusCode: 400,
    endpoints: ['intent_store'],
    response: {
      errors: [{ message: 'Invalid bundle signature', context: { hash: '0x0000000000000000000000000000000000000000000000000000000000000000' } }],
      traceId: 'mock-trace-000',
    },
  },
  {
    id: 'signature.userop-hash-mismatch',
    label: 'UserOp hash mismatch',
    category: 'signature',
    statusCode: 400,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'UserOp hash mismatch' }], traceId: 'mock-trace-000' },
  },
]
