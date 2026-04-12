import { useState, FormEvent } from 'react'

interface Props {
  onSubmit: (data: { name: string; capacity: number }) => Promise<void>
  onClose: () => void
}

export default function HallForm({ onSubmit, onClose }: Props) {
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onSubmit({ name: name.trim(), capacity: Number(capacity) })
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
        <h3 className="text-base font-semibold text-gray-900 mb-4">Новый зал</h3>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Название</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Главный зал"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Вместимость</label>
            <input
              required
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="500"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

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
              {submitting ? 'Создание…' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
