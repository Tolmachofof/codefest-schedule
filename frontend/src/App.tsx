import { useState, useEffect, useCallback } from 'react'
import type { Conference } from './types'
import {
  getConferences,
  createConference,
  updateConference,
  deleteConference,
  type ConferencePayload,
} from './api/conferences'
import { getMe, logout, type AuthUser } from './api/auth'
import ConferenceCard from './components/ConferenceCard'
import ConferenceForm from './components/ConferenceForm'
import ConfirmDialog from './components/ConfirmDialog'
import SchedulePage from './pages/SchedulePage'
import LogsPage from './pages/LogsPage'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const [conferences, setConferences] = useState<Conference[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Conference | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [scheduleId, setScheduleId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'conferences' | 'logs' | 'settings'>('conferences')

  // Check auth on mount
  useEffect(() => {
    getMe().then((u) => {
      setUser(u)
      setAuthChecked(true)
    })
  }, [])

  // Listen for 401 from API helpers
  useEffect(() => {
    const handler = () => setUser(null)
    window.addEventListener('auth:unauthorized', handler)
    return () => window.removeEventListener('auth:unauthorized', handler)
  }, [])

  const fetchConferences = useCallback(async () => {
    try {
      const data = await getConferences()
      setConferences(data)
    } catch {
      setError('Не удалось загрузить конференции')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user) fetchConferences()
  }, [user, fetchConferences])

  const handleCreate = async (data: ConferencePayload) => {
    const created = await createConference(data)
    setConferences((prev) => [...prev, created])
    setFormOpen(false)
  }

  const handleUpdate = async (data: ConferencePayload) => {
    if (!editing) return
    const updated = await updateConference(editing.id, data)
    setConferences((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
    closeForm()
  }

  const handleDelete = async () => {
    if (deletingId === null) return
    await deleteConference(deletingId)
    setConferences((prev) => prev.filter((c) => c.id !== deletingId))
    setDeletingId(null)
  }

  const handleLogout = async () => {
    await logout()
    setUser(null)
    setConferences([])
    setScheduleId(null)
  }

  const openCreate = () => { setEditing(null); setFormOpen(true) }
  const openEdit = (c: Conference) => { setEditing(c); setFormOpen(true) }
  const closeForm = () => { setFormOpen(false); setEditing(null) }

  // Waiting for auth check
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  if (scheduleId !== null) {
    return (
      <SchedulePage
        conferenceId={scheduleId}
        onBack={() => { setScheduleId(null); fetchConferences() }}
        onShowLogs={() => { setScheduleId(null); setActiveTab('logs'); fetchConferences() }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-blue-600">CodeFest</span>
              <span className="text-xl font-light text-gray-400">Schedule</span>
            </div>
            <nav className="flex items-center gap-1">
              <button
                onClick={() => setActiveTab('conferences')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'conferences'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Конференции
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'logs'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Логи
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'settings'
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Настройки
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {activeTab === 'conferences' && !editing && (
              <button
                onClick={openCreate}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                + Новая конференция
              </button>
            )}
            <div className="flex items-center gap-2 pl-3 border-l border-gray-200">
              <span className="text-sm text-gray-500">{user.username}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
                title="Выйти"
              >
                Выйти
              </button>
            </div>
          </div>
        </div>
      </header>

      {activeTab === 'settings' ? (
        <SettingsPage user={user} />
      ) : activeTab === 'logs' ? (
        <LogsPage />
      ) : (
        /* Main */
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          {loading && (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-16">
              <p className="text-red-600 mb-4">{error}</p>
              <button
                onClick={fetchConferences}
                className="text-sm text-blue-600 hover:underline"
              >
                Попробовать снова
              </button>
            </div>
          )}

          {!loading && !error && conferences.length === 0 && (
            <div className="text-center py-16">
              <p className="text-gray-400 text-lg mb-2">Конференций пока нет</p>
              <p className="text-gray-400 text-sm mb-6">Создайте первую конференцию</p>
              <button
                onClick={openCreate}
                className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                + Новая конференция
              </button>
            </div>
          )}

          {!loading && !error && conferences.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {conferences.map((c) => (
                <ConferenceCard
                  key={c.id}
                  conference={c}
                  onClick={() => setScheduleId(c.id)}
                  onEdit={() => openEdit(c)}
                  onDelete={() => setDeletingId(c.id)}
                />
              ))}
            </div>
          )}
        </main>
      )}

      {/* Form modal */}
      {formOpen && (
        <ConferenceForm
          mode={editing ? 'edit' : 'create'}
          initial={editing ?? undefined}
          onSubmit={editing ? handleUpdate : handleCreate}
          onClose={closeForm}
        />
      )}

      {/* Delete confirm */}
      {deletingId !== null && (
        <ConfirmDialog
          message={`Удалить конференцию «${conferences.find((c) => c.id === deletingId)?.name}»? Все связанные данные будут удалены.`}
          onConfirm={handleDelete}
          onCancel={() => setDeletingId(null)}
        />
      )}
    </div>
  )
}
