import type { ErrorScenario } from '../registry'

export const simulationScenarios: ErrorScenario[] = [
  {
    id: 'simulation.bundle-failed',
    label: 'Bundle simulation failed',
    category: 'simulation',
    statusCode: 400,
    endpoints: ['intent_store'],
    response: {
      errors: [{ message: 'Bundle simulation failed', context: { reason: 'execution reverted' } }],
      traceId: 'mock-trace-000',
    },
  },
  {
    id: 'simulation.gas-estimation-failure',
    label: 'Gas estimation failure',
    category: 'simulation',
    statusCode: 500,
    endpoints: ['intent_store'],
    response: { errors: [{ message: 'Unexpected returned data' }], traceId: 'mock-trace-000' },
  },
]
