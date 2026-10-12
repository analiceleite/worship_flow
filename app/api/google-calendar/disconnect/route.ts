import { NextResponse } from 'next/server'
import { AuthContextError, getCurrentMinisterContext } from '@/lib/auth-context'
import { disconnectMinister } from '@/lib/google-calendar/reconcile'

export async function POST() {
  let context
  try {
    context = await getCurrentMinisterContext()
  } catch (error) {
    if (error instanceof AuthContextError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  try {
    await disconnectMinister(context.ministerId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error disconnecting Google Calendar:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
