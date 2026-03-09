import type { Conference } from '../types'

interface Props {
  conference: Conference
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export default function ConferenceCard({ conference, onClick, onEdit, onDelete }: Props) {
  const { name, city, start_date, end_date, tracks, halls } = conference

  const dateLabel = `${formatDate(start_date)} — ${formatDate(end_date)}`
  const totalCapacity = halls.reduce((sum, h) => sum + h.capacity, 0)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <div className="p-5 flex flex-col gap-3 cursor-pointer flex-1" onClick={onClick}>
        <div>
          <h2 className="text-lg font-semibold text-gray-900 leading-snug">{name}</h2>
          <p className="mt-1 text-sm text-gray-500 flex items-center gap-1">
            <span>📍</span> {city}
          </p>
        </div>

        <p className="text-sm text-gray-600">
          <span className="font-medium">Даты:</span> {dateLabel}
        </p>

        <div className="flex gap-3">
          <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 rounded-full px-3 py-1 font-medium">
            {tracks.length} {pluralTracks(tracks.length)}
          </span>
          <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 rounded-full px-3 py-1 font-medium">
            {halls.length} {pluralHalls(halls.length)}
            {totalCapacity > 0 && <span className="text-purple-400 font-normal">· {totalCapacity} мест</span>}
          </span>
        </div>
      </div>

      <div className="flex gap-2 px-5 pb-4 pt-3 border-t border-gray-100">
        <button
          onClick={onEdit}
          className="flex-1 py-1.5 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Редактировать
        </button>
        <button
          onClick={onDelete}
          className="flex-1 py-1.5 text-sm font-medium text-red-600 rounded-lg hover:bg-red-50 transition-colors"
        >
          Удалить
        </button>
      </div>
    </div>
  )
}

function pluralTracks(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'трек'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'трека'
  return 'треков'
}

function pluralHalls(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'зал'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'зала'
  return 'залов'
}
