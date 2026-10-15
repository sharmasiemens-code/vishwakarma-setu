// Browser interaction tests with explicit synthetic API fixtures. Database/API
// integration lives in backend/tests/test_postgres_readiness.py.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox'] })
const errors = []
const stats = []
const uid = '11111111-1111-4111-8111-111111111111'
const sid = '22222222-2222-4222-8222-222222222222'
const kid = '33333333-3333-4333-8333-333333333333'
const tid = '44444444-4444-4444-8444-444444444444'
const job = '55555555-5555-4555-8555-555555555555'
const make = async (port, handler, role) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  if (role) await context.addInitScript(({ role }) => localStorage.setItem(`${role}_access_token`, 'browser-test-fixture-token'), { role })
  await context.route('http://127.0.0.1:8000/**', async (route) => {
    const url = new URL(route.request().url())
    const result = await handler(url.pathname, route.request().method(), route.request())
    await route.fulfill({ status: result?.status || 200, contentType: 'application/json', body: JSON.stringify(result?.body ?? result ?? {}) })
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${port}`)
  return { context, page }
}
const noOverflow = async (page) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile layout has horizontal overflow')
try {
  for (const withDetails of [false, true]) {
    let submitted
    const { context, page } = await make(5173, async (path, method, request) => {
      if (path === '/auth/register/customer') { submitted = request.postDataJSON(); return { access_token: 'test-token', user: { user_id: uid, role: 'CUSTOMER' } } }
      return { categories: [], services: [], requests: [], notifications: [] }
    })
    await page.getByRole('button', { name: /Create.*Account|Register|Sign Up/i }).last().click()
    await page.getByLabel('Full name', { exact: true }).fill('Browser Test Customer')
    await page.getByLabel('Mobile number', { exact: true }).fill('9876543210')
    await page.getByLabel('Create password', { exact: true }).fill('Original123')
    await page.getByLabel('Confirm password', { exact: true }).fill('Original123')
    if (withDetails) {
      await page.locator('summary').click()
      await page.getByLabel('Email (optional)', { exact: true }).fill('test@example.com')
      await page.getByLabel('Date of birth (optional)', { exact: true }).fill('1995-06-07')
    }
    await noOverflow(page)
    await page.getByRole('button', { name: 'Create Account and Continue', exact: true }).click()
    await page.waitForTimeout(250)
    assert.equal(submitted.email, withDetails ? 'test@example.com' : null)
    assert.equal(submitted.date_of_birth, withDetails ? '1995-06-07' : null)
    stats.push(`Customer registration ${withDetails ? 'with' : 'without'} optional fields`)
    await context.close()
  }
  let savedProfile
  {
    const { context, page } = await make(5173, async (path, method, request) => {
      if (path === '/auth/me') return { token_data: { sub: uid, role: 'CUSTOMER' } }
      if (path === '/customers/me/profile') {
        if (method === 'PUT') { savedProfile = request.postDataJSON(); return { message: 'Profile saved' } }
        return { profile: { full_name: 'Test Customer', phone: '9876543210', email: null, date_of_birth: null } }
      }
      return { requests: [], notifications: [], unread_count: 0 }
    }, 'customer')
    await page.getByRole('button', { name: 'Profile', exact: true }).click()
    await page.getByLabel('Email (optional)', { exact: true }).fill('profile@example.com')
    await page.getByLabel('Date of birth (optional)', { exact: true }).fill('1990-01-02')
    await page.getByRole('button', { name: 'Save Profile', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'Profile saved' }).waitFor()
    assert.equal(savedProfile.date_of_birth, '1990-01-02')
    await page.getByRole('button', { name: 'Change language / भाषा बदलें', exact: true }).click()
    await page.getByRole('heading', { name: 'प्रोफ़ाइल', exact: true }).waitFor()
    await context.setOffline(true)
    await page.getByRole('status').filter({ hasText: 'इंटरनेट नहीं है' }).waitFor()
    await noOverflow(page)
    stats.push('Profile edit, calendar date, Hindi toggle, offline banner, mobile layout')
    await context.close()
  }
  {
    let draft = { details: {}, version: 0 }; let submitted = false
    const options = { categories: [{ id: uid, name: 'Plumbing' }], services: [{ id: sid, category_id: uid, name: 'Tap repair' }], skills: [{ id: kid, name: 'Plumbing skill' }], tools: [{ id: tid, name: 'Spanner' }], required_skills: [{ service_id: sid, skill_id: kid }], required_tools: [{ service_id: sid, tool_id: tid }] }
    const { context, page } = await make(5174, async (path, method, request) => {
      if (path === '/auth/me') return { token_data: { sub: uid, role: 'TECHNICIAN', technician_id: tid } }
      if (path === '/auth/technician/application') return { application: { full_name: 'Test Technician', can_work: false, onboarding_required: !submitted, application_id: submitted ? uid : null } }
      if (path === '/auth/technician/registration-options') return options
      if (path === '/auth/technician/onboarding') {
        if (method === 'PUT') { const body = request.postDataJSON(); assert.equal(body.expected_version, draft.version); draft = { details: body.details, version: draft.version + 1 }; return { version: draft.version } }
        return { draft }
      }
      if (path === '/auth/technician/onboarding/submit') { submitted = true; return { status: 201, body: { application_id: uid } } }
      return {}
    }, 'technician')
    await page.getByLabel('Email address', { exact: true }).fill('tech@example.com')
    await page.getByLabel('Date of birth', { exact: true }).fill('1990-01-02')
    await page.getByLabel('Gender', { exact: true }).selectOption('OTHER')
    await page.getByRole('button', { name: 'Save and Continue', exact: true }).click()
    await page.getByLabel('Address', { exact: true }).waitFor()
    await page.reload()
    await page.getByLabel('Email address', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('input[name="email"]')?.value === 'tech@example.com')
    await page.getByRole('button', { name: 'Save and Continue', exact: true }).click()
    for (const [label, value] of [['Address', 'Test address'], ['City', 'Delhi'], ['State', 'Delhi'], ['Pincode', '110001'], ['Areas where you work', 'Central Delhi']]) await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByLabel('Work category', { exact: true }).selectOption(uid)
    for (const name of ['Tap repair', 'Plumbing skill', 'Spanner']) await page.getByRole('checkbox', { name, exact: true }).check()
    await page.getByRole('button', { name: 'Save and Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Submit for Verification', exact: true }).click()
    await page.getByRole('heading', { name: 'Technician Application', exact: true }).waitFor()
    assert.equal(submitted, true)
    await noOverflow(page)
    stats.push('Technician progress save/reload/resume, skills selection and pending-verification gate')
    await context.close()
  }
  {
    const row = { id: uid, job_id: job, rating: 4, review: 'Genuine test-fixture review', created_at: '2026-10-15T10:00:00Z' }
    let manualPosition
    const { context, page } = await make(5174, async (path, method, request) => {
      if (path === '/auth/me') return { token_data: { sub: uid, role: 'TECHNICIAN', technician_id: tid } }
      if (path === '/technicians/me/location') { manualPosition = request.postDataJSON(); return { message: 'Location saved' } }
      if (path === '/auth/technician/application') return { application: { can_work: true } }
      if (path === '/technicians/me/dashboard') return { dashboard: { profile: { full_name: 'Test Technician', availability_status: 'OFFLINE' }, job_summary: {}, active_job: null, recent_jobs: [] } }
      if (path === '/ratings/me') return { total_reviews: 1, rating_average: 4, reviews: [row] }
      if (path === `/ratings/job/${job}`) return { rating: row }
      if (path === '/notifications') return { notifications: [{ id: uid, title: 'New Rating Received', message: 'Customer has rated your completed service.', notification_type: 'RATING_RECEIVED', reference_id: job, is_read: false }] }
      if (path === '/notifications/unread-count') return { unread_count: 1 }
      return { jobs: [] }
    }, 'technician')
    await page.getByRole('button', { name: 'Go Online', exact: true }).click()
    await page.getByText(/Location permission was denied/).waitFor()
    await page.getByText('Manual location', { exact: true }).click()
    await page.getByLabel('Latitude', { exact: true }).fill('28.61')
    await page.getByLabel('Longitude', { exact: true }).fill('77.21')
    await page.getByRole('checkbox', { name: 'I confirm this is my current position' }).check()
    await page.getByRole('button', { name: 'Update Location', exact: true }).click()
    await page.getByText(/Position saved. Select Go Online/).waitFor()
    assert.equal(manualPosition.accuracy_meters, null)
    assert.equal(manualPosition.latitude, 28.61)
    stats.push('Denied GPS permission and confirmed manual technician position fallback')
    await page.getByRole('button', { name: /Notifications/ }).first().click()
    await page.getByRole('button', { name: /New Rating Received/ }).click()
    await page.getByRole('heading', { name: 'Your Ratings', exact: true }).waitFor()
    await page.getByText('Genuine test-fixture review', { exact: true }).waitFor()
    await noOverflow(page)
    stats.push('Rating notification opens matching review with genuine API summary/count')
    await context.close()
  }
  {
    let unauthorized = false
    const { context, page } = await make(5173, async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
      return { status: unauthorized ? 401 : 503, body: { detail: unauthorized ? 'Session expired' : 'Temporarily unavailable' } }
    }, 'customer')
    await page.getByRole('button', { name: 'Retry', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => Boolean(localStorage.getItem('customer_access_token'))), true)
    unauthorized = true
    await page.reload()
    await page.getByRole('heading', { name: 'Your session expired. Sign in again to continue.', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => localStorage.getItem('customer_access_token')), null)
    stats.push('Slow temporary failure preserves session; 401 clears expired token and prompts sign-in')
    await context.close()
  }
  assert.deepEqual(errors, [], 'Browser runtime errors')
  console.log(`${stats.length} browser scenarios passed:\n${stats.map((item) => `- ${item}`).join('\n')}`)
} finally { await browser.close() }
