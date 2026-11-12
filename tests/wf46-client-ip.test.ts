import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIp } from '../lib/auth/client-ip.ts'

function request(headers: Record<string, string>) {
  return new Request('https://example.test/api', { headers })
}

test('prefers the platform x-real-ip over any client-supplied forwarded chain', () => {
  assert.equal(clientIp(request({ 'x-real-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })), '198.51.100.7')
})

test('falls back to the last x-forwarded-for hop without trusting the leftmost value', () => {
  assert.equal(clientIp(request({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '10.0.0.1')
})

test('uses one shared bucket when no address can be determined', () => {
  assert.equal(clientIp(request({})), 'unknown')
  assert.equal(clientIp(request({ 'x-forwarded-for': ' , ' })), 'unknown')
})

test('bounds the subject length before it reaches the limiter', () => {
  assert.equal(clientIp(request({ 'x-real-ip': 'a'.repeat(200) })).length, 64)
})
