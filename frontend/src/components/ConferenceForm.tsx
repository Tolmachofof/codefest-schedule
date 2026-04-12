import { useState, useEffect, FormEvent } from 'react'
import type { ConferenceSummary } from '../types'
import type { ConferencePayload } from '../api/conferences'

interface Props {
  mode: 'create' | 'edit'
  initial?: ConferenceSummary
  onSubmit: (data: ConferencePayload) => Promise<void>
  onClose: () => void
}

type TrackRow = { id?: number; name: string; slots: string }

const emptyTrack = (): TrackRow => ({ name: '', slots: '' })

export default function ConferenceForm({ mode, initial, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [city, setCity] = useState(initial?.city ?? '')
  const [startDate, setStartDate] = useState(initial?.start_date ?? '')
  const [endDate, setEndDate] = useState(initial?.end_date ?? '')
  const [tracks, setTracks] = useState<TrackRow[]>(
    initial?.tracks.length
      ? initial.tracks.map((t) => ({ id: t.id, name: t.name, slots: String(t.slots) }))
      : [emptyTrack()]
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const updateTrack = (i: number, field: keyof TrackRow, value: string) =>
    setTracks((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)))

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (endDate < startDate) {
      setError('Дата окончания не может быть раньше даты начала')
      return
    }

    const payload: ConferencePayload = {
      name: name.trim(),
      city: city.trim(),
      start_date: startDate,
      end_date: endDate,
      tracks: tracks
        .filter((t) => t.name.trim())
        .map((t) => ({ ...(t.id !== undefined && { id: t.id }), name: t.name.trim(), slots: Number(t.slots) || 0 })),
    }

    setSubmitting(true)
    try {
      await onSubmit(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сервера')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-xl font-semibold text-gray-900">
            {mode === 'edit' ? 'Редактировать конференцию' : 'Новая конференция'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Название</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="CodeFest 2026"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Город</label>
              <input
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Новосибирск"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Дата начала</label>
                <input
                  required
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Дата окончания</label>
                <input
                  required
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Треки</span>
                <button
                  type="button"
                  onClick={() => setTracks((p) => [...p, emptyTrack()])}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  + Добавить трек
                </button>
              </div>
              <div className="space-y-2">
                {tracks.map((track, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      value={track.name}
                      onChange={(e) => updateTrack(i, 'name', e.target.value)}
                      placeholder="Название трека"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      min={0}
                      value={track.slots}
                      onChange={(e) => updateTrack(i, 'slots', e.target.value)}
                      placeholder="Слоты"
                      className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setTracks((p) => p.filter((_, idx) => idx !== i))}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Отмена
            </button>
            {mode === 'edit' ? (
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Сохранение…' : 'Сохранить'}
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Сохранение…' : 'Создать'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
