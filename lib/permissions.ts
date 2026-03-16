export function hasLeadVoiceRole(value: string | null | undefined) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes('voz')
}