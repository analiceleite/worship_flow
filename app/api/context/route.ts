import { NextResponse } from 'next/server'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'

export async function GET() {
  try {
    const context = await getCurrentMinisterContext()
    return NextResponse.json({ context })
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }
}
