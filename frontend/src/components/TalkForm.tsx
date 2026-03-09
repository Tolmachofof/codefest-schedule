import { useState, FormEvent } from 'react'
import TimeInput from './TimeInput'

interface Track {
  id: number
  name: string
}

interface Hall {
  id: number
  name: string
}

interface Day {
  id: number
  date: string
}

interface Props {
  hallName?: string
  tracks: Track[]
  halls?: Hall[]
  days?: Day[]
  mode?: 'create' | 'edit' | 'unassigned'
  initialTitle?: string
  initialStartTime?: string
  initialEndTime?: string
  initialPrimaryTrackId?: number | null
  initialTrackIds?: number[]
  initialDayId?: number
  initialHallId?: number | null
  onSubmit: (data: {
    title: string
    start_time?: string
    end_time?: string
    primary_track_id: number | null
    track_ids: number[]
    day_id?: number
    hall_id?: number
  }) => Promise<void>
  onClose: () => void
}

function formatDayDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })
}

export default function TalkForm({
  hallName, tracks, halls = [], days = [], mode = 'create',
  initialTitle = '', initialStartTime = '', initialEndTime = '',
  initialPrimaryTrackId = null, initialTrackIds = [], initialDayId, initialHallId,
  onSubmit, onClose,
}: Props) {
  const [title, setTitle] = useState(initialTitle)
  const [startTime, setStartTime] = useState(initialStartTime)
  const [endTime, setEndTime] = useState(initialEndTime)
  const [primaryTrackId, setPrimaryTrackId] = useState<number | null>(initialPrimaryTrackId)
  const [trackIds, setTrackIds] = useState<number[]>(initialTrackIds)
  const [dayId, setDayId] = useState<number | undefined>(initialDayId)
  const [hallId, setHallId] = useState<number | undefined>(
    initialHallId != null ? initialHallId : undefined
  )
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const togglePrimary = (id: number) => {
    if (primaryTrackId === id) {
      setPrimaryTrackId(null)
    } else {
      setPrimaryTrackId(id)
      setTrackIds((prev) => prev.filter((x) => x !== id))
    }
  }

  const toggleAdditional = (id: number) => {
    setTrackIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const showTimePickers = mode !== 'unassigned'
  const showDaySelector = mode === 'edit' && days.length > 1
  const showHallSelector = mode === 'edit' && halls.length > 0 && initialHallId == null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (showTimePickers) {
      if (!startTime || !endTime) {
        setError('Укажите время начала и окончания')
        return
      }
      if (endTime <= startTime) {
        setError('Время окончания должно быть позже начала')
        return
      }
    }

    setSubmitting(true)
    try {
      await onSubmit({
        title: title.trim(),
        primary_track_id: primaryTrackId,
        track_ids: trackIds,
        ...(showTimePickers && { start_time: startTime, end_time: endTime }),
        ...(dayId !== undefined && { day_id: dayId }),
        ...(hallId !== undefined && { hall_id: hallId }),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сервера')
    } finally {
      setSubmitting(false)
    }
  }

  const additionalTracks = tracks.filter((t) => t.id !== primaryTrackId)

  const title_label = mode === 'edit' ? 'Редактировать доклад' : 'Новый доклад'
  const subtitle = hallName ? `Зал: ${hallName}` : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">{title_label}</h3>
        {subtitle && <p className="text-xs text-gray-400 mb-4">{subtitle}</p>}

        {showDaySelector && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">День</label>
            <select
              value={dayId ?? ''}
              onChange={(e) => setDayId(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {days.map((d) => (
                <option key={d.id} value={d.id}>{formatDayDate(d.date)}</option>
              ))}
            </select>
          </div>
        )}

        {showHallSelector && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Зал</label>
            <select
              value={hallId ?? ''}
              onChange={(e) => setHallId(e.target.value ? Number(e.target.value) : undefined)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— не назначен —</option>
              {halls.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Название</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Название доклада"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {tracks.length > 0 && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Основной трек
                  <span className="ml-1 text-xs font-normal text-gray-400">(учитывается в заполнении)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {tracks.map((t) => {
                    const selected = primaryTrackId === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => togglePrimary(t.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          selected
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                        }`}
                      >
                        {t.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {additionalTracks.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Дополнительные треки
                    <span className="ml-1 text-xs font-normal text-gray-400">(не учитываются)</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {additionalTracks.map((t) => {
                      const selected = trackIds.includes(t.id)
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleAdditional(t.id)}
                          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                            selected
                              ? 'bg-violet-600 text-white border-violet-600'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-violet-400'
                          }`}
                        >
                          {t.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {showTimePickers && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Начало</label>
                <TimeInput value={startTime} onChange={setStartTime} className="w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Окончание</label>
                <TimeInput value={endTime} onChange={setEndTime} className="w-full" />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Сохранение…' : mode === 'edit' ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
