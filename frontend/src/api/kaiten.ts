import type { KaitenSettings, KaitenBoardConfig, KaitenSpace, KaitenBoard, KaitenColumn, KaitenCardField } from '../types'

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

export const getKaitenSettings = async (conferenceId: number): Promise<KaitenSettings | null> => {
  try {
    return await request<KaitenSettings>(`/conferences/${conferenceId}/kaiten/settings`)
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) return null
    if (err instanceof Error && err.message === 'Kaiten settings not found') return null
    throw err
  }
}

export interface KaitenSettingsInput {
  boards?: KaitenBoardConfig[]
  field_mapping?: Record<string, string | null> | null
}

export const saveKaitenSettings = (conferenceId: number, data: KaitenSettingsInput): Promise<KaitenSettings> =>
  request<KaitenSettings>(`/conferences/${conferenceId}/kaiten/settings`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })

export const getKaitenSpaces = (conferenceId: number): Promise<KaitenSpace[]> =>
  request<KaitenSpace[]>(`/conferences/${conferenceId}/kaiten/spaces`)

export const getKaitenBoards = (conferenceId: number, spaceId: number): Promise<KaitenBoard[]> =>
  request<KaitenBoard[]>(`/conferences/${conferenceId}/kaiten/boards?space_id=${spaceId}`)

export const getKaitenColumns = (conferenceId: number, boardId: number): Promise<KaitenColumn[]> =>
  request<KaitenColumn[]>(`/conferences/${conferenceId}/kaiten/columns?board_id=${boardId}`)

export const getKaitenCardFields = (conferenceId: number): Promise<KaitenCardField[]> =>
  request<KaitenCardField[]>(`/conferences/${conferenceId}/kaiten/card-fields`)

export interface ImportJob {
  status: 'pending' | 'running' | 'done' | 'error'
  imported: number
  updated: number
  error: string | null
}

export const startKaitenImport = (conferenceId: number): Promise<{ job_id: string; status: string }> =>
  request<{ job_id: string; status: string }>(`/conferences/${conferenceId}/kaiten/import`, {
    method: 'POST',
  })

export const getImportStatus = (conferenceId: number, jobId: string): Promise<ImportJob> =>
  request<ImportJob>(`/conferences/${conferenceId}/kaiten/import/${jobId}`)

export async function importKaitenTalks(
  conferenceId: number,
  onStatus?: (job: ImportJob) => void,
): Promise<ImportJob> {
  const { job_id } = await startKaitenImport(conferenceId)

  while (true) {
    await new Promise((r) => setTimeout(r, 1500))
    const job = await getImportStatus(conferenceId, job_id)
    onStatus?.(job)
    if (job.status === 'done' || job.status === 'error') return job
  }
}
