import type { Hall } from '../types'

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

export const createHall = (conferenceId: number, data: { name: string; capacity: number }) =>
  request<Hall>(`/conferences/${conferenceId}/halls`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const deleteHall = (hallId: number) =>
  request<void>(`/halls/${hallId}`, { method: 'DELETE' })

export const createUnassignedTalk = (
  conferenceId: number,
  data: { title: string; primary_track_id?: number | null; track_ids?: number[] }
) =>
  request(`/conferences/${conferenceId}/talks`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const createTalk = (
  conferenceId: number,
  dayId: number,
  data: { title: string; hall_id: number; start_time: string; end_time: string; primary_track_id?: number | null; track_ids?: number[] }
) =>
  request(`/conferences/${conferenceId}/days/${dayId}/talks`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const updateTalk = (
  talkId: number,
  data: { title?: string; hall_id?: number | null; day_id?: number; start_time?: string | null; end_time?: string | null; primary_track_id?: number | null; track_ids?: number[] }
) => request(`/talks/${talkId}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteTalk = (talkId: number) =>
  request<void>(`/talks/${talkId}`, { method: 'DELETE' })

export const createBreak = (
  conferenceId: number,
  dayId: number,
  data: { hall_id: number; start_time: string; end_time: string }
) =>
  request<{ id: number }>(`/conferences/${conferenceId}/days/${dayId}/breaks`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const updateBreak = (
  breakId: number,
  data: { hall_id?: number; day_id?: number; start_time?: string; end_time?: string }
) => request(`/breaks/${breakId}`, { method: 'PATCH', body: JSON.stringify(data) })

export const deleteBreak = (breakId: number) =>
  request<void>(`/breaks/${breakId}`, { method: 'DELETE' })

export interface LogEntry {
  id: number
  timestamp: string
  action: string
}

export const getLogs = () => request<LogEntry[]>('/logs')
