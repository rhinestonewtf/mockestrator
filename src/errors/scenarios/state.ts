import type { ErrorScenario } from '../registry'

export const stateScenarios: ErrorScenario[] = [
  {
    id: 'state.bundle-not-found',
    label: 'Bundle not found',
    category: 'state',
    statusCode: 404,
    endpoints: ['intent_status'],
    response: { errors: [{ message: 'Order bundle not found' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'state.claim-not-found',
    label: 'Claim not found',
    category: 'state',
    statusCode: 400,
    endpoints: ['intent_status'],
    response: { errors: [{ message: 'No such claim with nonce', context: { nonce: '0', chainId: 84532 } }], traceId: 'mock-trace-000' },
  },
  {
    id: 'state.concurrent-modification',
    label: 'Concurrent modification',
    category: 'state',
    statusCode: 400,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'No such compact bundle with nonce: 0 or it was concurrent modification' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'state.omni-lock-already-set',
    label: 'Omni lock already set',
    category: 'state',
    statusCode: 409,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'Omni lock already set' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'state.no-tokens-provided',
    label: 'No tokens provided',
    category: 'state',
    statusCode: 400,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'No tokens provided' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'state.no-unlocks-signed',
    label: 'No unlocks signed',
    category: 'state',
    statusCode: 500,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'No unlocks signed' }], traceId: 'mock-trace-000' },
  },
]
