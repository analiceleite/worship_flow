import ResetPasswordClient from '../../reset/ResetPasswordClient'

export default function Page({ params }: { params: { token: string } }) {
  const token = params.token || null
  console.log('[page /auth/reset/:token] params.token=', token)
  return <ResetPasswordClient token={token} />
}
