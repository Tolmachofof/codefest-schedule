import { useState, useEffect } from 'react'
import { getLogs, type LogEntry } from '../api/schedule'

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLogs = async () => {
    setLoading(true)
    const data = await getLogs()
    setLogs(data)
    setLoading(false)
  }

  useEffect(() => { fetchLogs() }, [])

  const formatTime = (s: string) => {
    const d = new Date(s)
    return d.toLocaleString('ru', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  }

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Журнал операций</h2>
        <button
          onClick={fetchLogs}
          className="text-sm text-blue-600 hover:underline"
        >
          Обновить
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400">Операций пока нет</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center gap-4">
              <span className="text-xs text-gray-400 shrink-0 tabular-nums">{formatTime(log.timestamp)}</span>
              <span className="text-sm text-gray-800">{log.action}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
