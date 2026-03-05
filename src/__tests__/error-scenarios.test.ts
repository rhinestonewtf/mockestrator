import { describe, it, expect, afterEach } from 'vitest'
import { ALL_SCENARIOS } from '../errors/scenarios'

const API_BASE_URL =
  process.env.MOCKESTRATOR_URL ?? 'http://localhost:4000'
const API_KEY = 'test-api-key'
const USER_ADDRESS = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
}

async function resetErrors() {
  await fetch(`${API_BASE_URL}/__admin/errors`, {
    method: 'DELETE',
    headers,
  })
}

describe('Error Scenario Registry', () => {
  describe('All scenarios have valid orchestrator response format', () => {
    for (const scenario of ALL_SCENARIOS) {
      it(`${scenario.id} has valid format`, () => {
        expect(scenario.statusCode).toBeGreaterThanOrEqual(400)
        expect(scenario.statusCode).toBeLessThanOrEqual(599)
        expect(scenario.response).toHaveProperty('errors')
        expect(Array.isArray(scenario.response.errors)).toBe(true)
        expect(scenario.response.errors.length).toBeGreaterThan(0)
        for (const err of scenario.response.errors) {
          expect(err).toHaveProperty('message')
          expect(typeof err.message).toBe('string')
          if (err.context !== undefined) {
            expect(typeof err.context).toBe('object')
          }
        }
      })
    }
  })

  describe('Scenario IDs are unique', () => {
    it('should have no duplicate IDs', () => {
      const ids = ALL_SCENARIOS.map((s) => s.id)
      const unique = new Set(ids)
      expect(unique.size).toBe(ids.length)
    })

    it('should have 49 total scenarios', () => {
      expect(ALL_SCENARIOS.length).toBe(49)
    })
  })
})

describe('Per-request header trigger (X-Mock-Error)', () => {
  afterEach(resetErrors)

  it('should return 401 for auth.invalid-api-key on intent_route', async () => {
    const response = await fetch(`${API_BASE_URL}/intents/route`, {
      method: 'POST',
      headers: {
        ...headers,
        'X-Mock-Error': 'auth.invalid-api-key',
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.errors).toBeDefined()
    expect(body.errors[0].message).toBe('Invalid API key')
  })

  it('should return 429 for infra.rate-limit on portfolio', async () => {
    const response = await fetch(
      `${API_BASE_URL}/accounts/${USER_ADDRESS}/portfolio`,
      {
        headers: {
          ...headers,
          'X-Mock-Error': 'infra.rate-limit',
        },
      },
    )

    expect(response.status).toBe(429)
    const body = await response.json()
    expect(body.errors[0].message).toBe('Too many requests')
  })

  it('should return 400 for validation.no-segments on intent_store', async () => {
    const response = await fetch(`${API_BASE_URL}/intent-operations`, {
      method: 'POST',
      headers: {
        ...headers,
        'X-Mock-Error': 'validation.no-segments',
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.errors[0].message).toBe('Bundle has no segments')
  })

  it('should return 404 for state.bundle-not-found on intent_status', async () => {
    const response = await fetch(
      `${API_BASE_URL}/intent-operation/12345`,
      {
        headers: {
          ...headers,
          'X-Mock-Error': 'state.bundle-not-found',
        },
      },
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.errors[0].message).toBe('Order bundle not found')
  })

  it('should pass through to happy path when no header set', async () => {
    const response = await fetch(
      `${API_BASE_URL}/accounts/${USER_ADDRESS}/portfolio`,
      { headers },
    )

    expect(response.status).toBe(200)
  })

  it('should not trigger endpoint-scoped scenario on wrong endpoint', async () => {
    // state.bundle-not-found only applies to intent_status
    const response = await fetch(
      `${API_BASE_URL}/accounts/${USER_ADDRESS}/portfolio`,
      {
        headers: {
          ...headers,
          'X-Mock-Error': 'state.bundle-not-found',
        },
      },
    )

    // Should pass through to happy path (200), not return 404
    expect(response.status).toBe(200)
  })
})

describe('Admin API', () => {
  afterEach(resetErrors)

  it('GET /__admin/errors/catalog should list all scenarios', async () => {
    const response = await fetch(`${API_BASE_URL}/__admin/errors/catalog`, {
      headers,
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.scenarios.length).toBe(49)
    expect(body.scenarios[0]).toHaveProperty('id')
    expect(body.scenarios[0]).toHaveProperty('category')
    expect(body.scenarios[0]).toHaveProperty('statusCode')
    expect(body.scenarios[0]).toHaveProperty('endpoints')
  })

  it('PUT /__admin/errors should set active scenarios', async () => {
    const putRes = await fetch(`${API_BASE_URL}/__admin/errors`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        scenarios: [{ id: 'auth.invalid-api-key', enabled: true }],
      }),
    })
    expect(putRes.status).toBe(200)

    const getRes = await fetch(`${API_BASE_URL}/__admin/errors`, { headers })
    const body = await getRes.json()
    expect(body.active.length).toBe(1)
    expect(body.active[0].id).toBe('auth.invalid-api-key')
  })

  it('PUT /__admin/errors should reject unknown scenario IDs', async () => {
    const response = await fetch(`${API_BASE_URL}/__admin/errors`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        scenarios: [{ id: 'nonexistent.scenario', enabled: true }],
      }),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.errors[0].message).toBe('Unknown scenario IDs')
  })

  it('POST /__admin/errors should merge scenarios', async () => {
    // Set initial
    await fetch(`${API_BASE_URL}/__admin/errors`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        scenarios: [{ id: 'auth.invalid-api-key', enabled: true }],
      }),
    })

    // Merge additional
    const postRes = await fetch(`${API_BASE_URL}/__admin/errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scenarios: [{ id: 'infra.rate-limit', enabled: true }],
      }),
    })
    expect(postRes.status).toBe(200)

    const getRes = await fetch(`${API_BASE_URL}/__admin/errors`, { headers })
    const body = await getRes.json()
    expect(body.active.length).toBe(2)
  })

  it('POST /__admin/errors/category/:cat should activate category', async () => {
    const response = await fetch(
      `${API_BASE_URL}/__admin/errors/category/auth`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ probability: 1.0 }),
      },
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.activated).toBe(5)

    // Verify it affects requests
    const intentRes = await fetch(`${API_BASE_URL}/intents/route`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })
    expect(intentRes.status).toBeGreaterThanOrEqual(400)
  })

  it('DELETE /__admin/errors should clear all and restore happy path', async () => {
    // Activate error
    await fetch(`${API_BASE_URL}/__admin/errors`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        scenarios: [{ id: 'auth.invalid-api-key', enabled: true }],
      }),
    })

    // Clear
    const delRes = await fetch(`${API_BASE_URL}/__admin/errors`, {
      method: 'DELETE',
      headers,
    })
    expect(delRes.status).toBe(200)
    const delBody = await delRes.json()
    expect(delBody.active).toEqual([])

    // Verify happy path restored
    const response = await fetch(
      `${API_BASE_URL}/accounts/${USER_ADDRESS}/portfolio`,
      { headers },
    )
    expect(response.status).toBe(200)
  })

  it('DELETE /__admin/errors/:id should remove specific scenario', async () => {
    // Set two scenarios
    await fetch(`${API_BASE_URL}/__admin/errors`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        scenarios: [
          { id: 'auth.invalid-api-key', enabled: true },
          { id: 'infra.rate-limit', enabled: true },
        ],
      }),
    })

    // Remove one
    await fetch(`${API_BASE_URL}/__admin/errors/auth.invalid-api-key`, {
      method: 'DELETE',
      headers,
    })

    const getRes = await fetch(`${API_BASE_URL}/__admin/errors`, { headers })
    const body = await getRes.json()
    expect(body.active.length).toBe(1)
    expect(body.active[0].id).toBe('infra.rate-limit')
  })
})

describe('Admin-configured errors affect requests', () => {
  afterEach(resetErrors)

  it('should return configured error on matching endpoint', async () => {
    await fetch(`${API_BASE_URL}/__admin/errors`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        scenarios: [{ id: 'path.no-path-found', enabled: true }],
      }),
    })

    const response = await fetch(`${API_BASE_URL}/intents/route`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.errors[0].message).toBe('No Path Found')
  })

  it('header should override admin config', async () => {
    // Admin sets rate-limit
    await fetch(`${API_BASE_URL}/__admin/errors`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        scenarios: [{ id: 'infra.rate-limit', enabled: true }],
      }),
    })

    // Header overrides with auth error
    const response = await fetch(`${API_BASE_URL}/intents/route`, {
      method: 'POST',
      headers: {
        ...headers,
        'X-Mock-Error': 'auth.invalid-api-key',
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.errors[0].message).toBe('Invalid API key')
  })
})
