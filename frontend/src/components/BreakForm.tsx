import { useState, FormEvent } from 'react'
import TimeInput from './TimeInput'

interface Props {
  hallName: string
  mode?: 'create' | 'edit'
  initialStartTime?: string
  initialEndTime?: string
  onSubmit: (data: { start_time: string; end_time: string; forAllHalls: boolean }) => Promise<void>
  onClose: () => void
}

export default function BreakForm({ hallName, mode = 'create', initialStartTime = '', initialEndTime = '', onSubmit, onClose }: Props) {
  const [startTime, setStartTime] = useState(initialStartTime)
  const [endTime, setEndTime] = useState(initialEndTime)
  const [forAllHalls, setForAllHalls] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (endTime <= startTime) {
      setError('Время окончания должно быть позже начала')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({ start_time: startTime, end_time: endTime, forAllHalls })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сервера')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-1">{mode === 'edit' ? 'Редактировать перерыв' : 'Новый перерыв'}</h3>
        <p className="text-xs text-gray-400 mb-4">Зал: {hallName}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
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

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={forAllHalls}
              onChange={(e) => setForAllHalls(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
            />
            <span className="text-sm text-gray-700">
              {mode === 'edit' ? 'Применить для всех залов' : 'Добавить для всех залов'}
            </span>
          </label>

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
              className="px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Сохранение…' : mode === 'edit' ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
