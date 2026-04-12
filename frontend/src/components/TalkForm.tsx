import { useState, FormEvent } from 'react'

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
  initialPrimaryTrackId?: number | null
  initialTrackIds?: number[]
  initialDayId?: number
  initialHallId?: number | null
  initialSpeakerName?: string
  initialSpeakerLevel?: string
  initialSpeakerCompany?: string
  initialSpeakerPosition?: string
  initialSpeakerBio?: string
  initialDescription?: string
  initialTalkFormat?: string
  initialDurationMinutes?: number
  initialRelevance?: number | null
  initialNovelty?: number | null
  initialApplicability?: number | null
  initialMassAppeal?: number | null
  initialSpeakerExperience?: number | null
  onSubmit: (data: {
    title: string
    primary_track_id: number | null
    track_ids: number[]
    speaker_name?: string | null
    speaker_level?: string | null
    speaker_company?: string | null
    speaker_position?: string | null
    speaker_bio?: string | null
    description?: string | null
    talk_format?: string | null
    duration_minutes?: number
    relevance?: number | null
    novelty?: number | null
    applicability?: number | null
    mass_appeal?: number | null
    speaker_experience?: number | null
  }) => Promise<void>
  onClose: () => void
}

const SPEAKER_LEVELS = [
  { value: '', label: '— не указан —' },
  { value: 'junior', label: 'Junior' },
  { value: 'middle', label: 'Middle' },
  { value: 'senior', label: 'Senior' },
  { value: 'keynote', label: 'Keynote' },
]

const RATING_LABELS: Record<string, string[]> = {
  relevance: ['Низкая', 'Слабая', 'Средняя', 'Высокая', 'Максимальная'],
  novelty: ['Копипаста', 'Баян', 'Находка есть, прорыва нет', 'Уникальный опыт', '100 баллов свежести'],
  applicability: ['Вдохновиться', 'Без рецепта', 'Фрагментарно', 'Toolkit', 'Под ключ'],
  mass_appeal: ['Для профи', 'Для своих', 'Связующее звено', 'Для всей команды', 'Для всей IT-кухни'],
  speaker_experience: ['Низкий', 'Ниже среднего', 'Средний', 'Высокий', 'Экспертный'],
}

function RatingField({
  label, field, value, onChange,
}: {
  label: string
  field: string
  value: number | null
  onChange: (v: number | null) => void
}) {
  const labels = RATING_LABELS[field] ?? []
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n
          return (
            <button
              key={n}
              type="button"
              title={labels[n - 1]}
              onClick={() => onChange(active ? null : n)}
              className={`flex-1 py-1.5 rounded text-xs font-semibold border transition-colors ${
                active
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {n}
            </button>
          )
        })}
      </div>
      {value !== null && (
        <p className="text-xs text-gray-400 mt-0.5">{labels[value - 1]}</p>
      )}
    </div>
  )
}

function formatDayDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })
}

export default function TalkForm({
  hallName, tracks, days = [], mode = 'create',
  initialTitle = '',
  initialPrimaryTrackId = null, initialTrackIds = [], initialDayId, initialHallId,
  initialSpeakerName = '', initialSpeakerLevel = '',
  initialSpeakerCompany = '', initialSpeakerPosition = '', initialSpeakerBio = '',
  initialDescription = '',
  initialTalkFormat = '',
  initialDurationMinutes = 40,
  initialRelevance = null, initialNovelty = null, initialApplicability = null,
  initialMassAppeal = null, initialSpeakerExperience = null,
  onSubmit, onClose,
}: Props) {
  const [title, setTitle] = useState(initialTitle)
  const [primaryTrackId, setPrimaryTrackId] = useState<number | null>(initialPrimaryTrackId)
  const [trackIds, setTrackIds] = useState<number[]>(initialTrackIds)
  const [speakerName, setSpeakerName] = useState(initialSpeakerName)
  const [speakerLevel, setSpeakerLevel] = useState(initialSpeakerLevel)
  const [speakerCompany, setSpeakerCompany] = useState(initialSpeakerCompany)
  const [speakerPosition, setSpeakerPosition] = useState(initialSpeakerPosition)
  const [speakerBio, setSpeakerBio] = useState(initialSpeakerBio)
  const [description, setDescription] = useState(initialDescription)
  const [talkFormat, setTalkFormat] = useState(initialTalkFormat)
  const [durationMinutes, setDurationMinutes] = useState(initialDurationMinutes)
  const [relevance, setRelevance] = useState<number | null>(initialRelevance)
  const [novelty, setNovelty] = useState<number | null>(initialNovelty)
  const [applicability, setApplicability] = useState<number | null>(initialApplicability)
  const [massAppeal, setMassAppeal] = useState<number | null>(initialMassAppeal)
  const [speakerExperience, setSpeakerExperience] = useState<number | null>(initialSpeakerExperience)
  const [speakerExpanded, setSpeakerExpanded] = useState(
    !!(initialSpeakerName || initialSpeakerLevel || initialSpeakerCompany || initialSpeakerPosition ||
       initialSpeakerBio || initialDescription ||
       initialRelevance || initialNovelty || initialApplicability || initialMassAppeal || initialSpeakerExperience)
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

  const showDurationField = mode === 'unassigned' || mode === 'edit'
  const isAssigned = initialHallId != null
  const showDayInfo = isAssigned && initialDayId != null && days.length > 0

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    setSubmitting(true)
    try {
      await onSubmit({
        title: title.trim(),
        primary_track_id: primaryTrackId,
        track_ids: trackIds,
        speaker_name: speakerName.trim() || null,
        speaker_level: speakerLevel || null,
        speaker_company: speakerCompany.trim() || null,
        speaker_position: speakerPosition.trim() || null,
        speaker_bio: speakerBio.trim() || null,
        description: description.trim() || null,
        talk_format: talkFormat.trim() || null,
        ...(showDurationField && { duration_minutes: durationMinutes }),
        relevance,
        novelty,
        applicability,
        mass_appeal: massAppeal,
        speaker_experience: speakerExperience,
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
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-gray-900 mb-1">{title_label}</h3>
        {subtitle && <p className="text-xs text-gray-400 mb-4">{subtitle}</p>}

        {showDayInfo && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">День</label>
            <p className="text-sm text-gray-600 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
              {formatDayDate(days.find((d) => d.id === initialDayId)!.date)}
            </p>
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

          {showDurationField && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Длительность, мин
                <span className="ml-1 text-xs font-normal text-gray-400">(используется при автораспределении)</span>
              </label>
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Talk info — collapsible */}
          <div className={`rounded-lg overflow-hidden border-2 transition-colors ${speakerExpanded ? 'border-blue-400' : 'border-blue-200 hover:border-blue-400'}`}>
            <button
              type="button"
              onClick={() => setSpeakerExpanded((v) => !v)}
              className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold transition-colors ${speakerExpanded ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
            >
              <span>📋 Информация о докладе</span>
              <span className={`transition-transform duration-200 text-base ${speakerExpanded ? 'rotate-0' : '-rotate-90'}`}>▾</span>
            </button>

            {speakerExpanded && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-100 pt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Имя спикера</label>
                  <input
                    value={speakerName}
                    onChange={(e) => setSpeakerName(e.target.value)}
                    placeholder="Иван Иванов"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Компания</label>
                    <input
                      value={speakerCompany}
                      onChange={(e) => setSpeakerCompany(e.target.value)}
                      placeholder="ACME Corp"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Должность</label>
                    <input
                      value={speakerPosition}
                      onChange={(e) => setSpeakerPosition(e.target.value)}
                      placeholder="Senior Engineer"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Уровень / статус</label>
                  <select
                    value={speakerLevel}
                    onChange={(e) => setSpeakerLevel(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {SPEAKER_LEVELS.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Био спикера</label>
                  <textarea
                    value={speakerBio}
                    onChange={(e) => setSpeakerBio(e.target.value)}
                    placeholder="Краткое описание спикера..."
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Формат выступления</label>
                  <input
                    value={talkFormat}
                    onChange={(e) => setTalkFormat(e.target.value)}
                    placeholder="RegularTalk, Workshop, LightningTalk..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Описание доклада</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Краткое описание темы..."
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>

                <div className="pt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-2">Оценки доклада</p>
                  <div className="space-y-3">
                    <RatingField label="Актуальность" field="relevance" value={relevance} onChange={setRelevance} />
                    <RatingField label="Новизна" field="novelty" value={novelty} onChange={setNovelty} />
                    <RatingField label="Применимость" field="applicability" value={applicability} onChange={setApplicability} />
                    <RatingField label="Массовость" field="mass_appeal" value={massAppeal} onChange={setMassAppeal} />
                    <RatingField label="Опыт спикера" field="speaker_experience" value={speakerExperience} onChange={setSpeakerExperience} />
                  </div>
                </div>
              </div>
            )}
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
              {submitting ? 'Сохранение…' : mode === 'edit' ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
