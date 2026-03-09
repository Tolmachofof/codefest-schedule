import { useState } from 'react'
import type { Hall } from '../types'

interface Props {
  allHalls: Hall[]
  assignedHallIds: number[]
  onSave: (hallIds: number[]) => Promise<void>
  onClose: () => void
}

export default function HallsModal({ allHalls, assignedHallIds, onSave, onClose }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set(assignedHallIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave([...selected])
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сервера')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Залы в этот день</h3>

        {allHalls.length === 0 ? (
          <p className="text-sm text-gray-400">Нет залов. Добавьте залы в настройках конференции.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {allHalls.map((hall) => (
              <label key={hall.id} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={selected.has(hall.id)}
                  onChange={() => toggle(hall.id)}
                  className="w-4 h-4 rounded accent-blue-600"
                />
                <span className="text-sm text-gray-800">{hall.name}</span>
                <span className="text-xs text-gray-400 ml-auto">{hall.capacity} мест</span>
              </label>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
