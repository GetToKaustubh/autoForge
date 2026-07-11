import { test, expect } from '@playwright/test'

// These tests verify basic page availability and unauthenticated redirect behaviour.
// They do NOT require a real Clerk session — they check the auth wall.

test.describe('Public routes', () => {
  test('root redirects unauthenticated users to sign-in', async ({ page }) => {
    await page.goto('/')
    // Clerk redirects unauthenticated requests — should not stay on /
    await expect(page).not.toHaveURL('/')
    // End up on a Clerk sign-in URL or a custom /sign-in page
    await expect(page.url()).toMatch(/sign[-_]?in|login/i)
  })

  test('/sign-in page loads', async ({ page }) => {
    const res = await page.goto('/sign-in')
    expect(res?.status()).toBeLessThan(500)
  })

  test('/sign-up page loads', async ({ page }) => {
    const res = await page.goto('/sign-up')
    expect(res?.status()).toBeLessThan(500)
  })

  test('/team/accept-invite shows invite UI without auth', async ({ page }) => {
    const res = await page.goto('/team/accept-invite?token=fake-token-for-smoke-test')
    // Page should render (200) — it handles the "not found" state in-page
    expect(res?.status()).toBeLessThan(500)
  })
})

test.describe('API health', () => {
  test('GET /api/channels returns 401 for unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/channels')
    expect(res.status()).toBe(401)
  })

  test('GET /api/analytics returns 401 for unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/analytics')
    expect(res.status()).toBe(401)
  })

  test('GET /api/billing/plans returns 401 for unauthenticated requests', async ({ request }) => {
    const res = await request.get('/api/billing/plans')
    expect(res.status()).toBe(401)
  })

  test('POST /api/team/invite returns 401 for unauthenticated requests', async ({ request }) => {
    const res = await request.post('/api/team/invite', {
      data: { email: 'test@example.com', role: 'editor' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/billing/checkout returns 401 for unauthenticated requests', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      data: { plan: 'starter' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/workflows returns 401 for unauthenticated requests', async ({ request }) => {
    const res = await request.post('/api/workflows', {
      data: { name: 'test', triggerType: 'manual', steps: [] },
    })
    expect(res.status()).toBe(401)
  })

  test('GET /api/monitoring/youtube-quota returns 401 for unauthenticated', async ({ request }) => {
    const res = await request.get('/api/monitoring/youtube-quota')
    expect(res.status()).toBe(401)
  })
})
