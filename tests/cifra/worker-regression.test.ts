import { expect, test } from 'vitest'

test('same_tone_does_not_wait_for_text_change', async () => {
  const { shouldWaitForCifraChange } = await import('../../services/cifraclub-importer/src/transpose-wait.js')
  expect(shouldWaitForCifraChange('G', 'G')).toBe(false)
  expect(shouldWaitForCifraChange('G#', 'Ab')).toBe(false)
  expect(shouldWaitForCifraChange('G', 'A')).toBe(true)
})
