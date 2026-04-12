const BASE = '/api'

export type AuthUser = { id: number; username: string }

export async function getMe(): Promise<AuthUser | null> {
  const res = await fetch(`${BASE}/auth/me`, { credentials: 'include' })
  if (!res.ok) return null
  return res.json()
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const body = new URLSearchParams({ username, password })
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Ошибка входа')
  }
  return res.json()
}

export async function logout(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(`${BASE}/auth/me/password`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail ?? 'Ошибка смены пароля')
  }
}
