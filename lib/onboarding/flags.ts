// WF-38 kill switch. Public church creation stays off until WF-46 (rate limits for public
// routes) is shipped and validated in production.
// Enable both, together, with the same value:
//   WF38_PUBLIC_CHURCH_CREATION=true              (server: API routes)
//   NEXT_PUBLIC_WF38_PUBLIC_CHURCH_CREATION=true  (client: login link and the public page)
export function publicChurchCreationEnabled(): boolean {
  return process.env.WF38_PUBLIC_CHURCH_CREATION === 'true'
}
