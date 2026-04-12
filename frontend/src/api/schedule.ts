import type { Hall, TalkItem, ScheduleVersion } from '../types'

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
  data: {
    title: string
    primary_track_id?: number | null
    track_ids?: number[]
    speaker_name?: string | null
    speaker_level?: string | null
    speaker_company?: string | null
    speaker_position?: string | null
    speaker_bio?: string | null
    description?: string | null
    talk_format?: string | null
    duration_minutes?: number
    relevance?: number | null
    novelty?: number | null
    applicability?: number | null
    mass_appeal?: number | null
    speaker_experience?: number | null
  }
) =>
  request<TalkItem>(`/conferences/${conferenceId}/talks`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const updateTalk = (
  talkId: number,
  data: {
    title?: string
    primary_track_id?: number | null
    track_ids?: number[]
    speaker_name?: string | null
    speaker_level?: string | null
    speaker_company?: string | null
    speaker_position?: string | null
    speaker_bio?: string | null
    description?: string | null
    talk_format?: string | null
    duration_minutes?: number
    relevance?: number | null
    novelty?: number | null
    applicability?: number | null
    mass_appeal?: number | null
    speaker_experience?: number | null
  }
) => request<TalkItem>(`/talks/${talkId}`, { method: 'PATCH', body: JSON.stringify(data) })

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

// ---------------------------------------------------------------------------
// Schedule versions
// ---------------------------------------------------------------------------

export const getDefaultPrompt = (): Promise<{ prompt: string }> =>
  request<{ prompt: string }>('/schedule/default-prompt')

export const getSchedulePrompt = (conferenceId: number): Promise<{ prompt: string }> =>
  request<{ prompt: string }>(`/conferences/${conferenceId}/schedule/prompt`)

export const saveSchedulePrompt = (conferenceId: number, prompt: string): Promise<{ prompt: string }> =>
  request<{ prompt: string }>(`/conferences/${conferenceId}/schedule/prompt`, {
    method: 'PATCH',
    body: JSON.stringify({ prompt }),
  })

export const generateSchedule = (conferenceId: number, prompt?: string, provider?: string) =>
  request<ScheduleVersion>(`/conferences/${conferenceId}/schedule/generate`, {
    method: 'POST',
    body: JSON.stringify({ prompt: prompt ?? null, provider: provider ?? null }),
  })

export const getScheduleVersions = (conferenceId: number) =>
  request<ScheduleVersion[]>(`/conferences/${conferenceId}/schedule/versions`)

export const activateScheduleVersion = (conferenceId: number, versionId: number) =>
  request<ScheduleVersion>(`/conferences/${conferenceId}/schedule/versions/${versionId}/activate`, {
    method: 'POST',
  })

export const deleteScheduleVersion = (conferenceId: number, versionId: number) =>
  request<void>(`/conferences/${conferenceId}/schedule/versions/${versionId}`, {
    method: 'DELETE',
  })

export const fillScheduleVersion = (conferenceId: number, versionId: number, provider?: string) =>
  request<ScheduleVersion>(`/conferences/${conferenceId}/schedule/versions/${versionId}/fill`, {
    method: 'POST',
    body: JSON.stringify({ provider: provider ?? null }),
  })

export const createManualVersion = (conferenceId: number) =>
  request<ScheduleVersion>(`/conferences/${conferenceId}/schedule/versions/manual`, {
    method: 'POST',
  })

export const removeVersionPlacement = (conferenceId: number, versionId: number, talkId: number) =>
  request<void>(`/conferences/${conferenceId}/schedule/versions/${versionId}/talks/${talkId}`, {
    method: 'DELETE',
  })

export const updateVersionPlacement = (
  conferenceId: number,
  versionId: number,
  talkId: number,
  data: { hall_id: number; day_id: number; start_time: string; end_time: string },
) =>
  request<ScheduleVersion>(`/conferences/${conferenceId}/schedule/versions/${versionId}/talks/${talkId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })

export const addVersionPlacement = (
  conferenceId: number,
  versionId: number,
  data: { talk_id: number; hall_id: number; day_id: number; start_time: string; end_time: string },
) =>
  request<ScheduleVersion>(`/conferences/${conferenceId}/schedule/versions/${versionId}/talks`, {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const exportScheduleExcel = async (conferenceId: number, versionId?: number | null) => {
  const url = `/api/conferences/${conferenceId}/schedule/export${versionId != null ? `?version_id=${versionId}` : ''}`
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = disposition.match(/filename="([^"]+)"/)
  const filename = match ? match[1] : 'schedule.xlsx'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export interface LogEntry {
  id: number
  timestamp: string
  action: string
}

export const getLogs = (limit = 100, offset = 0) =>
  request<LogEntry[]>(`/logs?limit=${limit}&offset=${offset}`)
