export function createPublicCache({ maxEntries = 100, maxBytes = 20 * 1024 * 1024, ttlMs = 7 * 86400000, now = Date.now } = {}) {
  const entries = new Map(); let bytes = 0
  const remove = (key) => { const entry = entries.get(key); if (entry) { bytes -= entry.bytes; entries.delete(key) } }
  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= now()) { remove(key); return undefined }
      entries.delete(key); entries.set(key, entry)
      return structuredClone(entry.value)
    },
    set(key, value) {
      const size = Buffer.byteLength(JSON.stringify(value)); remove(key)
      if (size > maxBytes) return
      for (const [oldKey, entry] of entries) if (entry.expiresAt <= now()) remove(oldKey)
      while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value)
      entries.set(key, { value: structuredClone(value), bytes: size, expiresAt: now() + ttlMs }); bytes += size
    },
  }
}
