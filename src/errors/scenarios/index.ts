import type { ErrorScenario } from '../registry'
import { authScenarios } from './auth'
import { validationScenarios } from './validation'
import { tokenScenarios } from './token'
import { signatureScenarios } from './signature'
import { simulationScenarios } from './simulation'
import { stateScenarios } from './state'
import { pathScenarios } from './path'
import { infraScenarios } from './infra'
import { parsingScenarios } from './parsing'

export const ALL_SCENARIOS: ErrorScenario[] = [
  ...authScenarios,
  ...validationScenarios,
  ...tokenScenarios,
  ...signatureScenarios,
  ...simulationScenarios,
  ...stateScenarios,
  ...pathScenarios,
  ...infraScenarios,
  ...parsingScenarios,
]

export const SCENARIO_MAP = new Map<string, ErrorScenario>(
  ALL_SCENARIOS.map((s) => [s.id, s]),
)
