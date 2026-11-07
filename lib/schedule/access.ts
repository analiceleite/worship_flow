import { ROUTES } from '@/lib/routes'

export function canMediaAccessSchedule(pathname: string) {
  return pathname.replace(/\/$/, '') === ROUTES.SCHEDULE
}

export function canShowMediaNavigation(href: string) {
  return href === ROUTES.REPERTOIRE || href === ROUTES.SCHEDULE
}
