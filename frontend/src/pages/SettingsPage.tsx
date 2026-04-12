import { useState } from 'react'
import { changePassword } from '../api/auth'
import type { AuthUser } from '../api/auth'

interface Props {
  user: AuthUser
}

export default function SettingsPage({ user }: Props) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (newPassword !== confirmPassword) {
      setError('Новые пароли не совпадают')
      return
    }

    setLoading(true)
    try {
      await changePassword(currentPassword, newPassword)
      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка смены пароля')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="max-w-md">
        <h1 className="text-lg font-semibold text-gray-800 mb-6">Настройки</h1>

        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="mb-6 pb-6 border-b border-gray-100">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Пользователь</p>
            <p className="text-sm font-medium text-gray-800">{user.username}</p>
          </div>

          <h2 className="text-sm font-semibold text-gray-700 mb-4">Смена пароля</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Текущий пароль
              </label>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Новый пароль
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                minLength={8}
              />
              <p className="mt-1 text-xs text-gray-400">Минимум 8 символов</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Повторите новый пароль
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-green-600">Пароль успешно изменён</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Сохранение...' : 'Сменить пароль'}
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
