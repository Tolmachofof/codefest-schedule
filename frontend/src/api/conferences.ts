import type { Conference } from '../types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:unauthorized'))
    throw new Error('Unauthorized')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export type ConferencePayload = {
  name: string
  city: string
  start_date: string
  end_date: string
  tracks: { name: string; slots: number }[]
}

export const getConferences = () => request<Conference[]>('/conferences')

export const createConference = (data: ConferencePayload) =>
  request<Conference>('/conferences', { method: 'POST', body: JSON.stringify(data) })

export const updateConference = (id: number, data: Partial<ConferencePayload>) =>
  request<Conference>(`/conferences/${id}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteConference = (id: number) =>
  request<void>(`/conferences/${id}`, { method: 'DELETE' })
