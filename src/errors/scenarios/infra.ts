import type { ErrorScenario } from '../registry'

export const infraScenarios: ErrorScenario[] = [
  {
    id: 'infra.rate-limit',
    label: 'Rate limited',
    category: 'infra',
    statusCode: 429,
    endpoints: ['*'],
    response: { errors: [{ message: 'Too many requests' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'infra.rpc-error',
    label: 'RPC error',
    category: 'infra',
    statusCode: 500,
    endpoints: ['*'],
    response: { errors: [{ message: 'RPC request failed' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'infra.queue-connection-failed',
    label: 'Queue connection failed',
    category: 'infra',
    statusCode: 500,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'RabbitMQ connection failed' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'infra.missing-config',
    label: 'Missing config',
    category: 'infra',
    statusCode: 500,
    endpoints: ['*'],
    response: { errors: [{ message: 'Missing environment variable' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'infra.unknown-provider',
    label: 'Unknown provider',
    category: 'infra',
    statusCode: 500,
    endpoints: ['*'],
    response: { errors: [{ message: 'Unknown provider' }], traceId: 'mock-trace-000' },
  },
]
