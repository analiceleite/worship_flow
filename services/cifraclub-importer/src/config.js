export function readConfig(env = process.env) {
  if (!env.CIFRACLUB_IMPORTER_TOKEN || env.CIFRACLUB_IMPORTER_TOKEN.length < 16) throw Error('CIFRACLUB_IMPORTER_TOKEN must contain at least 16 characters')
  return { port: Number(env.PORT || 3010), token: env.CIFRACLUB_IMPORTER_TOKEN }
}
