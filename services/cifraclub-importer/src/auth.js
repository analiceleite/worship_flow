import { timingSafeEqual } from 'node:crypto'
export function authorize(req, token) {
  const expected = Buffer.from(`Bearer ${token}`)
  const actual = Buffer.from(req.headers.authorization || '')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Object.assign(Error('UNAUTHORIZED'), { status: 401 })
}
