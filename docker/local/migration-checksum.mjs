import crypto from 'node:crypto'

const hash = text => crypto.createHash('sha256').update(text).digest('hex')

export function migrationChecksum(sql) {
  return hash(sql.replace(/\r\n/g, '\n'))
}

// Older local runners stored raw bytes. Accept either newline convention without
// rewriting history; any other SQL change must still stop migration execution.
export function migrationMatches(sql, checksum) {
  const lf = sql.replace(/\r\n/g, '\n')
  return [hash(sql), hash(lf), hash(lf.replace(/\n/g, '\r\n'))].includes(checksum)
}
