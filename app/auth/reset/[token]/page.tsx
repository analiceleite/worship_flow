import ResetPasswordClient from '../ResetPasswordClient'

// Older links intentionally require a fresh recovery request.
export default function Page() {
  return <ResetPasswordClient legacy />
}
