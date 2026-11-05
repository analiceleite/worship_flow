/** Choose only the most specific matching destination, not all of its parents. */
export function getActiveNavigationHref(pathname: string, items: readonly { href: string }[]) {
  let activeHref: string | undefined

  for (const { href } of items) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue
    if (!activeHref || href.length > activeHref.length) activeHref = href
  }

  return activeHref
}
