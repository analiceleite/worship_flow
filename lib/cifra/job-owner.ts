import { createHmac } from 'node:crypto'
import type { ImportScope } from './contract'
function digest(parts: string[]): string {
  const token = process.env.CIFRACLUB_IMPORTER_TOKEN
  if (!token || token.length < 16) throw new Error('NOT_CONFIGURED')
  return createHmac('sha256', token).update(JSON.stringify(parts)).digest('hex')
}
export function deriveOwner(scope: ImportScope): { ownerRef: string; churchRef: string } {
  return { ownerRef: digest(['cifra-owner-v1', scope.userId, scope.churchId]), churchRef: digest(['cifra-church-v1', scope.churchId]) }
}
export function deriveJobId(ownerRef: string, requestId: string): string { return digest(['cifra-job-v1', ownerRef, requestId]) }
