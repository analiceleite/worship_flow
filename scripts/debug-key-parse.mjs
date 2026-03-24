const parseCifraClubUrl = (input) => {
  try {
    const url = new URL(input.trim())
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/')
    if (parts.length >= 2) {
      const version = parts[2]?.toLowerCase().endsWith('.html') ? parts[2] : undefined
      const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
      const hashParams = new URLSearchParams(hash)
      const rawKey = hashParams.get('key')
      const parsedKey = rawKey == null ? undefined : Number(rawKey)
      const key = parsedKey != null && Number.isInteger(parsedKey) && parsedKey >= 0 ? parsedKey : undefined
      return { artist: parts[0], song: parts[1], version, key }
    }
  } catch {
    return null
  }
  return null
}

const url = 'https://www.cifraclub.com.br/gabriela-rocha/eu-sou-teu-rooftops/#key=7&tabs=false&instrument=keyboard'
console.log(parseCifraClubUrl(url))
