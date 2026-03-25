import ResetPasswordClient from './ResetPasswordClient'

export default function Page({ searchParams }: { searchParams?: { token?: string } }) {
  const token = searchParams?.token || null
  return <ResetPasswordClient token={token} />
}
