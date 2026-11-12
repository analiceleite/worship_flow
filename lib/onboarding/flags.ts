// WF-38 kill switch. Public church creation stays off until WF-46 (rate limits for public
// routes) is shipped and validated in production.
// One server-only variable. The browser learns the state from GET /api/onboarding/availability,
// so no NEXT_PUBLIC_ value is needed:
//   WF38_PUBLIC_CHURCH_CREATION=true              (server: API routes and availability)
export function publicChurchCreationEnabled(): boolean {
  return process.env.WF38_PUBLIC_CHURCH_CREATION === 'true'
}
