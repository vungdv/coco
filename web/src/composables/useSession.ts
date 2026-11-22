import { ref } from 'vue'
import { hasBackend, supabase } from '../lib/supabase'

export type SessionState = 'loading' | 'signedout' | 'denied' | 'ok'
export const sessionState = ref<SessionState>(hasBackend ? 'loading' : 'ok')

function apply(user: { app_metadata?: Record<string, unknown> } | null | undefined) {
  sessionState.value = !user ? 'signedout' : user.app_metadata?.role === 'staff' ? 'ok' : 'denied'
}

export function initSession() {
  if (!supabase) return
  supabase.auth.getSession().then(({ data }) => apply(data.session?.user))
  supabase.auth.onAuthStateChange((_e, s) => apply(s?.user)) // token refresh is silent (S15)
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase!.auth.signInWithPassword({ email, password })
  return error ? 'Invalid email or password' : null
}

export async function signOut() { await supabase?.auth.signOut() }
