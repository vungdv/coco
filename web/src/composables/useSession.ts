import { ref } from 'vue'
import type { MessageKey } from '../i18n'
import { hasBackend, supabase } from '../lib/supabase'

export type SessionState = 'loading' | 'signedout' | 'denied' | 'setpassword' | 'ok'
let passwordSet = false
export const sessionState = ref<SessionState>(hasBackend ? 'loading' : 'ok')

function apply(user: { app_metadata?: Record<string, unknown> } | null | undefined) {
  if (user && fromEmailLink && !passwordSet) { sessionState.value = 'setpassword'; return }
  sessionState.value = !user ? 'signedout' : user.app_metadata?.role === 'staff' ? 'ok' : 'denied'
}

// Invite / recovery links arrive as #access_token=...&type=invite|recovery; supabase-js clears the hash,
// so remember it before the client initialises.
const fromEmailLink = /[#&]type=(invite|recovery)\b/.test(location.hash)

export function initSession() {
  if (!supabase) return
  supabase.auth.getSession().then(({ data }) => apply(data.session?.user))
  supabase.auth.onAuthStateChange((_e, s) => apply(s?.user)) // token refresh is silent (S15)
}

/** Resolves to a message key on failure, null on success. */
export async function signIn(email: string, password: string): Promise<MessageKey | null> {
  const { error } = await supabase!.auth.signInWithPassword({ email, password })
  return error ? 'login.invalid' : null
}

export async function signOut() { await supabase?.auth.signOut() }

export async function setPassword(password: string): Promise<string | null> {
  const { error } = await supabase!.auth.updateUser({ password })
  if (error) return error.message
  passwordSet = true
  const { data } = await supabase!.auth.getSession()
  apply(data.session?.user)
  return null
}
