import type { ErrorScenario } from '../registry'

export const pathScenarios: ErrorScenario[] = [
  {
    id: 'path.no-path-found',
    label: 'No path found',
    category: 'path',
    statusCode: 400,
    endpoints: ['intent_route'],
    response: { errors: [{ message: 'No Path Found' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'path.invalid-intent',
    label: 'Invalid intent structure',
    category: 'path',
    statusCode: 400,
    endpoints: ['intent_route'],
    response: { errors: [{ message: 'Invalid intent structure' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'path.output-token-not-in-target',
    label: 'Output token not in target',
    category: 'path',
    statusCode: 500,
    endpoints: ['intent_route'],
    response: { errors: [{ message: 'Output token not in target' }], traceId: 'mock-trace-000' },
  },
  {
    id: 'path.token-pricing-failure',
    label: 'Token pricing failure',
    category: 'path',
    statusCode: 500,
    endpoints: ['intent_route'],
    response: { errors: [{ message: 'Token processing failure', context: { segmentIndex: 0, tokenIndex: 0 } }], traceId: 'mock-trace-000' },
  },
]
