import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'
import { migrationChecksum, migrationMatches } from '../docker/local/migration-checksum.mjs'

test('local migration checksums accept LF/CRLF and legacy raw hashes without accepting SQL changes', () => {
  const lf = 'BEGIN;\nSELECT 1;\nCOMMIT;\n'
  const crlf = lf.replace(/\n/g, '\r\n')
  const legacyWindowsHash = crypto.createHash('sha256').update(crlf).digest('hex')
  assert.equal(migrationChecksum(lf), migrationChecksum(crlf))
  assert.equal(migrationMatches(crlf, migrationChecksum(lf)), true)
  assert.equal(migrationMatches(lf, legacyWindowsHash), true)
  assert.equal(migrationMatches(lf.replace('SELECT 1', 'SELECT 2'), legacyWindowsHash), false)
  assert.equal(migrationMatches(lf.trim(), migrationChecksum(lf)), false)
})
