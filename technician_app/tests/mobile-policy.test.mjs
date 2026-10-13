import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMobileApi, makeCapacitorConfig } from '../scripts/mobile-policy.mjs'

test('release requires HTTPS and an actual API address', () => {
  assert.equal(validateMobileApi('https://api.fusiontel.in/'), 'https://api.fusiontel.in')
  for (const value of ['', 'not-url', 'http://192.168.1.2:8000', 'https://localhost:8000', 'https://api.your-domain.example']) {
    assert.throws(() => validateMobileApi(value))
  }
})
test('HTTP is allowed only by an explicit local-testing flag', () => {
  assert.equal(validateMobileApi('http://127.0.0.1:8000', true), 'http://127.0.0.1:8000')
  assert.throws(() => validateMobileApi('ftp://localhost', true))
})
test('API addresses cannot carry credentials or unrelated URL components', () => {
  for (const value of ['https://user:secret@api.test.in', 'https://api.test.in/path', 'https://api.test.in?token=x', 'https://api.test.in#fragment']) {
    assert.throws(() => validateMobileApi(value))
  }
})
test('native app packages local assets and keeps mixed content disabled', () => {
  const secure = makeCapacitorConfig()
  assert.equal(secure.webDir, 'dist')
  assert.equal(secure.server.androidScheme, 'https')
  assert.equal(secure.android.allowMixedContent, false)
  assert.equal(secure.server.url, undefined)
  assert.equal(makeCapacitorConfig(true).server.androidScheme, 'http')
})
