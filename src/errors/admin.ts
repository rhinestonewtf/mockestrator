import type { Express, Request, Response } from 'express'
import { ALL_SCENARIOS, SCENARIO_MAP } from './scenarios'
import type { ErrorConfig } from './config'
import {
  setActiveScenarios,
  getActiveScenarios,
  getAllScenarios,
  clearActiveScenarios,
} from './config'

export function setupAdminRoutes(app: Express) {
  // List all available error scenarios
  app.get('/__admin/errors/catalog', (_req: Request, res: Response) => {
    const catalog = ALL_SCENARIOS.map((s) => ({
      id: s.id,
      label: s.label,
      category: s.category,
      statusCode: s.statusCode,
      endpoints: s.endpoints,
    }))
    res.json({ scenarios: catalog })
  })

  // Get currently active error configurations
  app.get('/__admin/errors', (_req: Request, res: Response) => {
    res.json({ active: getActiveScenarios() })
  })

  // Replace all active error configurations
  app.put('/__admin/errors', (req: Request, res: Response) => {
    const { scenarios } = req.body as { scenarios: ErrorConfig[] }
    const invalid = scenarios.filter((s) => !SCENARIO_MAP.has(s.id))
    if (invalid.length > 0) {
      return res.status(400).json({
        errors: [
          {
            message: 'Unknown scenario IDs',
            context: { ids: invalid.map((i) => i.id) },
          },
        ],
      })
    }
    setActiveScenarios(scenarios)
    res.json({ active: getActiveScenarios() })
  })

  // Merge/add scenarios to active list
  app.post('/__admin/errors', (req: Request, res: Response) => {
    const { scenarios } = req.body as { scenarios: ErrorConfig[] }
    const invalid = scenarios.filter((s) => !SCENARIO_MAP.has(s.id))
    if (invalid.length > 0) {
      return res.status(400).json({
        errors: [
          {
            message: 'Unknown scenario IDs',
            context: { ids: invalid.map((i) => i.id) },
          },
        ],
      })
    }
    const current = getAllScenarios()
    const merged = new Map(current.map((s) => [s.id, s]))
    for (const s of scenarios) {
      merged.set(s.id, s)
    }
    setActiveScenarios(Array.from(merged.values()))
    res.json({ active: getActiveScenarios() })
  })

  // Activate all scenarios in a category
  app.post(
    '/__admin/errors/category/:category',
    (req: Request, res: Response) => {
      const { category } = req.params
      const { probability } = req.body as { probability?: number }
      const matching = ALL_SCENARIOS.filter((s) => s.category === category)
      if (matching.length === 0) {
        return res.status(400).json({
          errors: [{ message: 'Unknown category', context: { category } }],
        })
      }
      const configs: ErrorConfig[] = matching.map((s) => ({
        id: s.id,
        enabled: true,
        probability: probability ?? 1.0,
      }))
      const current = getAllScenarios()
      const merged = new Map(current.map((s) => [s.id, s]))
      for (const c of configs) {
        merged.set(c.id, c)
      }
      setActiveScenarios(Array.from(merged.values()))
      res.json({ active: getActiveScenarios(), activated: configs.length })
    },
  )

  // Clear all active error configurations
  app.delete('/__admin/errors', (_req: Request, res: Response) => {
    clearActiveScenarios()
    res.json({ active: [] })
  })

  // Remove a specific scenario
  app.delete('/__admin/errors/:scenarioId', (req: Request, res: Response) => {
    const current = getAllScenarios().filter(
      (s) => s.id !== req.params.scenarioId,
    )
    setActiveScenarios(current)
    res.json({ active: getActiveScenarios() })
  })
}
