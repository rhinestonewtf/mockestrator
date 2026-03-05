import type { ErrorScenario } from '../registry'

export const tokenScenarios: ErrorScenario[] = [
  {
    id: 'token.unsupported-chain',
    label: 'Unsupported chain id',
    category: 'token',
    statusCode: 400,
    endpoints: ['intent_route', 'intent_store'],
    response: { errors: [{ message: 'Unsupported chain id', context: { chainId: 999999 } }], traceId: 'mock-trace-000' },
  },
  {
    id: 'token.unsupported-address',
    label: 'Unsupported token addresses',
    category: 'token',
    statusCode: 400,
    endpoints: ['intent_route', 'intent_store'],
    response: {
      errors: [{ message: 'Unsupported token addresses', context: { tokens: ['0x0000000000000000000000000000000000000000'] } }],
      traceId: 'mock-trace-000',
    },
  },
  {
    id: 'token.insufficient-balance',
    label: 'Insufficient balance for token transfer',
    category: 'token',
    statusCode: 400,
    endpoints: ['intent_route', 'intent_store'],
    response: {
      errors: [{
        message: 'Insufficient balance for token transfer',
        context: { required: '1000000', balance: '0', token: '0x0000000000000000000000000000000000000000' },
      }],
      traceId: 'mock-trace-000',
    },
  },
  {
    id: 'token.malformed-token-out',
    label: 'Malformed tokenOut entry',
    category: 'token',
    statusCode: 400,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'Malformed tokenOut entry' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'token.insufficient-input-value',
    label: 'Insufficient input value',
    category: 'token',
    statusCode: 400,
    endpoints: ['intent_route', 'intent_store'],
    response: {
      errors: [{ message: 'Insufficient input value', context: { totalInputUSD: '0.50', totalOutputUSD: '1.00' } }],
      traceId: 'mock-trace-000',
    },
  },
  {
    id: 'token.exceeds-max-value',
    label: 'Exceeds maximum bundle value',
    category: 'token',
    statusCode: 400,
    endpoints: ['intent_route', 'intent_store'],
    response: {
      errors: [{ message: 'Exceeds maximum bundle value', context: { totalInputUSD: '100000', maxValue: '10000' } }],
      traceId: 'mock-trace-000',
    },
  },
]
