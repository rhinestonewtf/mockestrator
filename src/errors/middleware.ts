import type { Request, Response, NextFunction } from 'express'
import { getActiveScenarios } from './config'
import { SCENARIO_MAP } from './scenarios'
import type { EndpointTarget } from './registry'

function matchEndpoint(req: Request): EndpointTarget | undefined {
  if (req.method === 'GET' && /^\/accounts\/0x[a-fA-F0-9]+\/portfolio$/.test(req.path))
    return 'portfolio'
  if (req.method === 'POST' && req.path === '/intents/route') return 'intent_route'
  if (req.method === 'POST' && req.path === '/intent-operations') return 'intent_store'
  if (req.method === 'GET' && req.path.startsWith('/intent-operation/'))
    return 'intent_status'
  return undefined
}

function parseErrorHeader(value: string): { scenarioId: string; probability: number } {
  const parts = value.split(';')
  const scenarioId = parts[0].trim()
  let probability = 1.0
  const probPart = parts.find((p) => p.trim().startsWith('probability='))
  if (probPart) {
    const parsed = parseFloat(probPart.split('=')[1])
    if (!Number.isNaN(parsed)) probability = parsed
  }
  return { scenarioId, probability }
}

function appliesToEndpoint(
  endpoints: EndpointTarget[],
  endpoint: EndpointTarget,
): boolean {
  return endpoints.includes('*') || endpoints.includes(endpoint)
}

function shouldTrigger(probability: number): boolean {
  return Math.random() < probability
}

export function errorInjectionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const endpoint = matchEndpoint(req)
  if (!endpoint) return next()

  // Priority 1: Per-request header
  const headerValue = req.header('X-Mock-Error')
  if (headerValue) {
    const { scenarioId, probability } = parseErrorHeader(headerValue)
    const scenario = SCENARIO_MAP.get(scenarioId)
    if (scenario && appliesToEndpoint(scenario.endpoints, endpoint)) {
      if (shouldTrigger(probability)) {
        const body = scenario.responseFactory
          ? scenario.responseFactory(req)
          : scenario.response
        return res.status(scenario.statusCode).json(body)
      }
    }
    return next()
  }

  // Priority 2: Admin-configured active scenarios
  const activeScenarios = getActiveScenarios()
  for (const config of activeScenarios) {
    const scenario = SCENARIO_MAP.get(config.id)
    if (scenario && appliesToEndpoint(scenario.endpoints, endpoint)) {
      if (shouldTrigger(config.probability ?? 1.0)) {
        const body = scenario.responseFactory
          ? scenario.responseFactory(req)
          : scenario.response
        return res.status(scenario.statusCode).json(body)
      }
    }
  }

  return next()
}
