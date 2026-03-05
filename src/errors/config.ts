export interface ErrorConfig {
  id: string
  enabled: boolean
  probability?: number
}

let activeScenarios: ErrorConfig[] = []

export function getAllScenarios(): ErrorConfig[] {
  return activeScenarios
}

export function getActiveScenarios(): ErrorConfig[] {
  return activeScenarios.filter((s) => s.enabled)
}

export function setActiveScenarios(scenarios: ErrorConfig[]) {
  activeScenarios = scenarios
}

export function clearActiveScenarios() {
  activeScenarios = []
}

export function initFromEnv() {
  const envErrors = process.env.MOCK_ERRORS
  if (!envErrors) return

  const configs: ErrorConfig[] = envErrors.split(',').map((entry) => {
    const [id, probStr] = entry.split(':')
    return {
      id: id.trim(),
      enabled: true,
      probability: probStr ? (Number.isNaN(parseFloat(probStr)) ? 1.0 : parseFloat(probStr)) : 1.0,
    }
  })

  setActiveScenarios(configs)
}
