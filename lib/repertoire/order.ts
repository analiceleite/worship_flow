export const REPERTOIRE_PAGE_SIZE = 10

export function repertoirePage(position: number) {
  return Math.floor((position - 1) / REPERTOIRE_PAGE_SIZE) + 1
}

export function clampRepertoirePage(page: number, total: number) {
  return Math.max(1, Math.min(page, Math.max(1, Math.ceil(total / REPERTOIRE_PAGE_SIZE))))
}
