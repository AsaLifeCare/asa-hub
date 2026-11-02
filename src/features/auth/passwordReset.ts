// THE TWO ENDS OF A RESET ON THIS SIDE: the ask a locked-out person makes from the sign-in page, and the password…
import { useAuthStore } from '@/auth/useAuthStore'
import { gasAction } from '@/features/hiring/shared'
import { DEFAULT_EXEC_URL, useApiConfigStore } from '@/stores/useApiConfigStore'

/** The one answer the forgot form gives, whatever happened behind it. */
export const FORGOT_ANSWER =
  'If that sign-in belongs to an account, a temporary password is on its way — by e-mail to the address on ' +
  'the account, or by text to the phone on the account when the e-mail cannot reach you. It works once, ' +
  'within 30 minutes, and you choose your own right after signing in with it.'

// The ask, with no session: the token this browser may still hold is never sent, so a stale one cannot turn it into…
export async function askForTemporaryPassword(identifier: string): Promise<void> {
  const url = useApiConfigStore.getState().execUrl || DEFAULT_EXEC_URL
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'body=' + encodeURIComponent(JSON.stringify({
        action: 'authForgot', payload: { identifier: identifier.trim() },
      })),
    })
  } catch { /* the generic answer stands either way */ }
}

export const CHOOSE_PASSWORD_WHY =
  'You signed in with a temporary password. Choose one only you know before going any further — it ' +
  'protects the records tied to your name, and the temporary one stops working the moment you save.'

export type SaveOutcome = { ok: true } | { ok: false; error: string }

// The person's own password, checked the way the server checks it and saved through the profile door.
export async function saveOwnPassword(pw: string, confirm: string): Promise<SaveOutcome> {
  if (pw.length < 8) return { ok: false, error: 'Your password needs at least 8 characters.' }
  if (pw !== confirm) return { ok: false, error: 'The two passwords do not match.' }
  try {
    await gasAction('profileUpdate', { password: pw })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not save your password. Try again.' }
  }
  useAuthStore.getState().applyUser({ mustChangePassword: false })
  return { ok: true }
}
