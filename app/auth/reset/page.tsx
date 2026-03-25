import ResetPasswordClient from './ResetPasswordClient'

export default function Page({ searchParams }: { searchParams?: { token?: string } }) {
  const token = searchParams?.token || null
  console.log('[page /auth/reset] searchParams.token=', token)
  return <ResetPasswordClient token={token} />
}
