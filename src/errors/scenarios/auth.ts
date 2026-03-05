import type { ErrorScenario } from '../registry'

export const authScenarios: ErrorScenario[] = [
  {
    id: 'auth.invalid-api-key',
    label: 'Invalid API key',
    category: 'auth',
    statusCode: 401,
    endpoints: ['*'],
    response: { errors: [{ message: 'Invalid API key' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'auth.missing-api-key',
    label: 'Missing API key',
    category: 'auth',
    statusCode: 401,
    endpoints: ['*'],
    response: { errors: [{ message: 'Authentication is required' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'auth.insufficient-permissions',
    label: 'Insufficient permissions',
    category: 'auth',
    statusCode: 403,
    endpoints: ['*'],
    response: { errors: [{ message: 'Insufficient permissions' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'auth.account-not-omni-locked',
    label: 'Account not omni locked',
    category: 'auth',
    statusCode: 403,
    endpoints: ['intent_store'],
    response: {
      errors: [{ message: 'Account not omni locked', context: { address: '0x0000000000000000000000000000000000000000', chainId: '84532' } }],
      traceId: 'mock-trace-000',
    },
  },
  {
    id: 'auth.origin-module-not-installed',
    label: 'Origin module not installed',
    category: 'auth',
    statusCode: 403,
    endpoints: ['intent_store'],
    response: {
      errors: [{
        message: 'Origin module not installed',
        context: { address: '0x0000000000000000000000000000000000000000', originChainId: 84532, originModule: '0x0000000000000000000000000000000000000000' },
      }],
      traceId: 'mock-trace-000',
    },
  },
]
