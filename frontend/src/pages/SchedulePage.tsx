import { useState, useEffect, useRef } from 'react'
import type { Conference, DayDetails, Hall, Track, TalkItem, BreakItem } from '../types'
import { getConferences } from '../api/conferences'
import {
  createHall, deleteHall,
  createTalk, createUnassignedTalk, updateTalk, deleteTalk,
  createBreak, updateBreak, deleteBreak,
} from '../api/schedule'
import HallForm from '../components/HallForm'
import TalkForm from '../components/TalkForm'
import BreakForm from '../components/BreakForm'
import ConfirmDialog from '../components/ConfirmDialog'

// ---------------------------------------------------------------------------
// Grid constants
// ---------------------------------------------------------------------------

const SLOT_H = 40           // px per 20-minute slot
const GRID_START = 9 * 60   // 09:00 in minutes from midnight
const GRID_END = 19 * 60    // 19:00 in minutes from midnight
const SLOT_MIN = 20
const TOTAL_SLOTS = (GRID_END - GRID_START) / SLOT_MIN  // 30

const SLOTS = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
  const totalMin = GRID_START + i * SLOT_MIN
  return { index: i, totalMin, isHour: totalMin % 60 === 0 }
})

function timeToSlot(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return ((h * 60 + m) - GRID_START) / SLOT_MIN
}

function slotToTimeStr(slot: number): string {
  const totalMin = GRID_START + slot * SLOT_MIN
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

function formatSlotTime(totalMin: number): string {
  return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`
}

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function formatTime(t: string) { return t.slice(0, 5) }

// ---------------------------------------------------------------------------
// Track colors
// ---------------------------------------------------------------------------

const TRACK_COLORS = [
  { bg: 'bg-violet-100', border: 'border-violet-300', text: 'text-violet-800', dot: 'bg-violet-500' },
  { bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-800', dot: 'bg-emerald-500' },
  { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-800', dot: 'bg-orange-500' },
  { bg: 'bg-pink-100', border: 'border-pink-300', text: 'text-pink-800', dot: 'bg-pink-500' },
  { bg: 'bg-teal-100', border: 'border-teal-300', text: 'text-teal-800', dot: 'bg-teal-500' },
  { bg: 'bg-indigo-100', border: 'border-indigo-300', text: 'text-indigo-800', dot: 'bg-indigo-500' },
  { bg: 'bg-rose-100', border: 'border-rose-300', text: 'text-rose-800', dot: 'bg-rose-500' },
  { bg: 'bg-cyan-100', border: 'border-cyan-300', text: 'text-cyan-800', dot: 'bg-cyan-500' },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  conferenceId: number
  onBack: () => void
  onShowLogs: () => void
}

type DragItem = {
  kind: 'talk' | 'break'
  id: number
  hallId: number | null
  dayId: number
  durationSlots: number
}

type DragOver = { hallId: number; dayId: number; slot: number } | null

// ---------------------------------------------------------------------------
// SchedulePage
// ---------------------------------------------------------------------------

export default function SchedulePage({ conferenceId, onBack, onShowLogs }: Props) {
  const [conference, setConference] = useState<Conference | null>(null)
  const [loading, setLoading] = useState(true)
  const [dropError, setDropError] = useState('')

  const [tracksCollapsed, setTracksCollapsed] = useState(false)
  const [unassignedCollapsed, setUnassignedCollapsed] = useState(false)
  const [showHallForm, setShowHallForm] = useState(false)
  const [deletingHall, setDeletingHall] = useState<Hall | null>(null)
  const [addingTalkFor, setAddingTalkFor] = useState<{ hall: Hall; dayId: number; startTime: string; endTime: string } | null>(null)
  const [addingBreakFor, setAddingBreakFor] = useState<{ hall: Hall; dayId: number; startTime: string; endTime: string } | null>(null)
  const [addingUnassignedTalk, setAddingUnassignedTalk] = useState(false)
  const [editingTalk, setEditingTalk] = useState<{ talk: TalkItem; hall: Hall | null } | null>(null)
  const [editingBreak, setEditingBreak] = useState<{ br: BreakItem; hall: Hall } | null>(null)

  const dragItemRef = useRef<DragItem | null>(null)
  const [dragOver, setDragOver] = useState<DragOver>(null)

  const fetchAll = async () => {
    const all = await getConferences()
    setConference(all.find((c) => c.id === conferenceId) ?? null)
    setLoading(false)
  }

  const refresh = async () => {
    const all = await getConferences()
    setConference(all.find((c) => c.id === conferenceId) ?? null)
  }

  useEffect(() => { fetchAll() }, []) // eslint-disable-line

  // Auto-scroll when dragging near viewport edges
  useEffect(() => {
    const EDGE = 100
    const MAX_SPEED = 18
    let speed = 0
    let frame: number

    const onDragOver = (e: DragEvent) => {
      if (!dragItemRef.current) { speed = 0; return }
      if (e.clientY < EDGE) {
        speed = -MAX_SPEED * (1 - e.clientY / EDGE)
      } else if (e.clientY > window.innerHeight - EDGE) {
        speed = MAX_SPEED * ((e.clientY - (window.innerHeight - EDGE)) / EDGE)
      } else {
        speed = 0
      }
    }

    const tick = () => {
      if (speed !== 0) window.scrollBy(0, speed)
      frame = requestAnimationFrame(tick)
    }

    document.addEventListener('dragover', onDragOver)
    frame = requestAnimationFrame(tick)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      cancelAnimationFrame(frame)
    }
  }, [])

  const handleAddHall = async (data: { name: string; capacity: number }) => {
    if (!conference) return
    await createHall(conference.id, data)
    await refresh()
  }

  const handleConfirmDeleteHall = async () => {
    if (!deletingHall) return
    await deleteHall(deletingHall.id)
    setDeletingHall(null)
    await refresh()
  }

  const handleAddTalk = async (data: { title: string; start_time?: string; end_time?: string; primary_track_id: number | null; track_ids: number[] }) => {
    if (!conference || !addingTalkFor) return
    await createTalk(conference.id, addingTalkFor.dayId, {
      title: data.title,
      start_time: data.start_time!,
      end_time: data.end_time!,
      primary_track_id: data.primary_track_id,
      track_ids: data.track_ids,
      hall_id: addingTalkFor.hall.id,
    })
    await refresh()
  }

  const handleAddBreak = async (data: { start_time: string; end_time: string; forAllHalls: boolean }) => {
    if (!conference || !addingBreakFor) return
    const { forAllHalls, ...breakData } = data
    if (forAllHalls) {
      const norm = (t: string) => t.slice(0, 5)
      const st = norm(breakData.start_time)
      const et = norm(breakData.end_time)
      const day = conference.days.find((d) => d.id === addingBreakFor.dayId)
      // Skip halls that already have a break with identical times
      const hallsToCreate = conference.halls.filter(
        (hall) => !day?.breaks.some((b) => b.hall_id === hall.id && norm(b.start_time) === st && norm(b.end_time) === et)
      )
      const results = await Promise.allSettled(
        hallsToCreate.map((hall) =>
          createBreak(conference.id, addingBreakFor.dayId, { ...breakData, hall_id: hall.id })
        )
      )
      const failures = results
        .map((r, i) => r.status === 'rejected' ? hallsToCreate[i].name : null)
        .filter(Boolean) as string[]
      if (failures.length > 0) {
        const created = results
          .filter((r): r is PromiseFulfilledResult<{ id: number }> => r.status === 'fulfilled')
          .map((r) => r.value)
        await Promise.allSettled(created.map((br) => deleteBreak(br.id)))
        await refresh()
        throw new Error(`Не удалось создать перерыв для залов: ${failures.join(', ')}`)
      }
    } else {
      await createBreak(conference.id, addingBreakFor.dayId, { ...breakData, hall_id: addingBreakFor.hall.id })
    }
    await refresh()
  }

  const handleCreateUnassignedTalk = async (data: { title: string; primary_track_id: number | null; track_ids: number[] }) => {
    if (!conference) return
    await createUnassignedTalk(conference.id, data)
    await refresh()
  }

  const handleEditTalk = async (data: { title: string; start_time?: string; end_time?: string; primary_track_id: number | null; track_ids: number[]; day_id?: number; hall_id?: number }) => {
    if (!editingTalk) return
    await updateTalk(editingTalk.talk.id, data)
    await refresh()
  }

  const handleEditBreak = async (data: { start_time: string; end_time: string; forAllHalls: boolean }) => {
    if (!editingBreak || !conference) return
    const { forAllHalls, ...breakData } = data
    await updateBreak(editingBreak.br.id, breakData)
    if (forAllHalls) {
      const norm = (t: string) => t.slice(0, 5)
      const st = norm(breakData.start_time)
      const et = norm(breakData.end_time)
      const day = conference.days.find((d) => d.breaks.some((b) => b.id === editingBreak.br.id))
      if (day) {
        const hallsToCreate = conference.halls.filter(
          (hall) =>
            hall.id !== editingBreak.hall.id &&
            !day.breaks.some((b) => b.hall_id === hall.id && norm(b.start_time) === st && norm(b.end_time) === et)
        )
        if (hallsToCreate.length > 0) {
          const results = await Promise.allSettled(
            hallsToCreate.map((hall) =>
              createBreak(conference.id, day.id, { ...breakData, hall_id: hall.id })
            )
          )
          const failures = results
            .map((r, i) => r.status === 'rejected' ? hallsToCreate[i].name : null)
            .filter(Boolean) as string[]
          if (failures.length > 0) {
            const created = results
              .filter((r): r is PromiseFulfilledResult<{ id: number }> => r.status === 'fulfilled')
              .map((r) => r.value)
            await Promise.allSettled(created.map((br) => deleteBreak(br.id)))
            await refresh()
            throw new Error(`Не удалось создать перерыв для залов: ${failures.join(', ')}`)
          }
        }
      }
    }
    await refresh()
  }

  const handleDeleteTalk = async (talk: TalkItem) => {
    await deleteTalk(talk.id)
    await refresh()
  }
  const handleDeleteBreak = async (br: BreakItem) => {
    await deleteBreak(br.id)
    await refresh()
  }

  const handleDragStart = (item: DragItem) => {
    dragItemRef.current = item
    setDropError('')
  }

  const handleDragEnd = () => {
    dragItemRef.current = null
    setDragOver(null)
  }

  const handleSlotDragOver = (hallId: number, dayId: number, slot: number) => {
    setDragOver((prev) =>
      prev?.hallId === hallId && prev?.dayId === dayId && prev?.slot === slot
        ? prev
        : { hallId, dayId, slot }
    )
  }

  const handleSlotDrop = async (targetHallId: number, targetDayId: number, targetSlot: number) => {
    setDragOver(null)
    const item = dragItemRef.current
    dragItemRef.current = null
    if (!item) return

    // Clamp so item doesn't go beyond grid end
    const slot = Math.min(targetSlot, TOTAL_SLOTS - item.durationSlots)
    const newStart = slotToTimeStr(slot)
    const newEnd = slotToTimeStr(slot + item.durationSlots)
    // Unassigned talks (hallId === null) always need day_id since they're being placed for the first time
    const dayChanged = targetDayId !== item.dayId || item.hallId === null

    try {
      if (item.kind === 'talk') {
        await updateTalk(item.id, {
          hall_id: targetHallId,
          start_time: newStart,
          end_time: newEnd,
          ...(dayChanged && { day_id: targetDayId }),
        })
      } else {
        await updateBreak(item.id, {
          hall_id: targetHallId,
          start_time: newStart,
          end_time: newEnd,
          ...(dayChanged && { day_id: targetDayId }),
        })
      }
      await refresh()
    } catch (err) {
      setDropError(err instanceof Error ? err.message : 'Ошибка при перемещении')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (!conference) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Конференция не найдена</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors shrink-0"
          >
            ← Назад
          </button>
          <div className="h-4 w-px bg-gray-200 shrink-0" />
          <span className="font-semibold text-gray-900 min-w-0 truncate">{conference.name}</span>
          <span className="text-sm text-gray-400 shrink-0">📍 {conference.city}</span>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <button
              onClick={onShowLogs}
              className="px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Логи
            </button>
            <button
              onClick={() => setShowHallForm(true)}
              className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              + Добавить зал
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-10">
        {dropError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 flex justify-between items-center">
            <span>{dropError}</span>
            <button onClick={() => setDropError('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
          </div>
        )}

        <TracksPanel conference={conference} collapsed={tracksCollapsed} onCollapse={() => setTracksCollapsed((v) => !v)} />

        <UnassignedTalksPanel
          conference={conference}
          collapsed={unassignedCollapsed}
          onCollapse={() => setUnassignedCollapsed((v) => !v)}
          onAdd={() => setAddingUnassignedTalk(true)}
          onEdit={(talk) => setEditingTalk({ talk, hall: null })}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />

        {conference.halls.length === 0 && (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
            <p className="text-gray-400 mb-3">Залов пока нет</p>
            <button onClick={() => setShowHallForm(true)} className="text-sm font-medium text-blue-600 hover:underline">
              Добавить первый зал →
            </button>
          </div>
        )}

        {conference.days.map((day) => (
          <DayGrid
            key={day.id}
            day={day}
            halls={conference.halls}
            tracks={conference.tracks}
            dragOver={dragOver}
            dragItem={dragItemRef.current}
            onAddTalk={(hall, startTime, endTime) => setAddingTalkFor({ hall, dayId: day.id, startTime, endTime })}
            onAddBreak={(hall, startTime, endTime) => setAddingBreakFor({ hall, dayId: day.id, startTime, endTime })}
            onEditTalk={(talk, hall) => setEditingTalk({ talk, hall })}
            onEditBreak={(br, hall) => setEditingBreak({ br, hall })}
            onDeleteTalk={handleDeleteTalk}
            onDeleteBreak={handleDeleteBreak}
            onDeleteHall={setDeletingHall}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onSlotDragOver={handleSlotDragOver}
            onSlotDrop={handleSlotDrop}
          />
        ))}
      </main>

      {showHallForm && <HallForm onSubmit={handleAddHall} onClose={() => setShowHallForm(false)} />}
      {deletingHall && (
        <ConfirmDialog
          message={`Удалить зал «${deletingHall.name}»? Все связанные доклады и перерывы будут удалены.`}
          onConfirm={handleConfirmDeleteHall}
          onCancel={() => setDeletingHall(null)}
        />
      )}
      {addingTalkFor && (
        <TalkForm
          hallName={addingTalkFor.hall.name}
          tracks={conference.tracks}
          initialStartTime={addingTalkFor.startTime}
          initialEndTime={addingTalkFor.endTime}
          onSubmit={handleAddTalk}
          onClose={() => setAddingTalkFor(null)}
        />
      )}
      {addingBreakFor && (
        <BreakForm
          hallName={addingBreakFor.hall.name}
          initialStartTime={addingBreakFor.startTime}
          initialEndTime={addingBreakFor.endTime}
          onSubmit={handleAddBreak}
          onClose={() => setAddingBreakFor(null)}
        />
      )}
      {addingUnassignedTalk && (
        <TalkForm
          mode="unassigned"
          tracks={conference.tracks}
          onSubmit={handleCreateUnassignedTalk}
          onClose={() => setAddingUnassignedTalk(false)}
        />
      )}
      {editingTalk && (
        <TalkForm
          mode="edit"
          hallName={editingTalk.hall?.name}
          tracks={conference.tracks}
          halls={editingTalk.hall == null ? conference.halls : undefined}
          days={conference.days}
          initialTitle={editingTalk.talk.title}
          initialStartTime={editingTalk.talk.start_time ? formatTime(editingTalk.talk.start_time) : ''}
          initialEndTime={editingTalk.talk.end_time ? formatTime(editingTalk.talk.end_time) : ''}
          initialPrimaryTrackId={editingTalk.talk.primary_track_id}
          initialTrackIds={editingTalk.talk.track_ids}
          initialDayId={editingTalk.talk.day_id}
          initialHallId={editingTalk.hall?.id ?? null}
          onSubmit={handleEditTalk}
          onClose={() => setEditingTalk(null)}
        />
      )}
      {editingBreak && (
        <BreakForm
          mode="edit"
          hallName={editingBreak.hall.name}
          initialStartTime={formatTime(editingBreak.br.start_time)}
          initialEndTime={formatTime(editingBreak.br.end_time)}
          onSubmit={handleEditBreak}
          onClose={() => setEditingBreak(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UnassignedTalksPanel
// ---------------------------------------------------------------------------

interface UnassignedTalksPanelProps {
  conference: Conference
  collapsed: boolean
  onCollapse: () => void
  onAdd: () => void
  onEdit: (talk: TalkItem) => void
  onDragStart: (item: DragItem) => void
  onDragEnd: () => void
}

const DEFAULT_UNASSIGNED_SLOTS = 2 // 40-min default duration for drag ghost

function UnassignedTalksPanel({ conference, collapsed, onCollapse, onAdd, onEdit, onDragStart, onDragEnd }: UnassignedTalksPanelProps) {
  const unassigned = conference.days.flatMap((d) => d.talks).filter((t) => t.hall_id == null)
  const [draggingId, setDraggingId] = useState<number | null>(null)

  return (
    <div className="bg-white rounded-2xl border border-gray-200">
      <div className="flex items-center justify-between">
        <button
          onClick={onCollapse}
          className="flex items-center gap-2 flex-1 px-5 py-4 hover:bg-gray-50 rounded-l-2xl transition-colors text-left"
        >
          <h3 className="text-sm font-semibold text-gray-700">Нужно распределить</h3>
          {unassigned.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full">
              {unassigned.length}
            </span>
          )}
          <span className={`text-gray-400 transition-transform duration-200 ml-1 ${collapsed ? '-rotate-90' : ''}`}>▾</span>
        </button>
        <button
          onClick={onAdd}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium px-5 py-4 shrink-0"
        >
          + Добавить доклад
        </button>
      </div>

      {!collapsed && (unassigned.length === 0 ? (
        <p className="text-xs text-gray-400 px-5 pb-4">Все доклады распределены</p>
      ) : (
        <div className="flex flex-wrap gap-2 px-5 pb-4">
          {unassigned.map((talk) => {
            const trackIdx = talk.primary_track_id != null
              ? conference.tracks.findIndex((t) => t.id === talk.primary_track_id)
              : -1
            const color = trackIdx >= 0 ? TRACK_COLORS[trackIdx % TRACK_COLORS.length] : null
            const isDragging = draggingId === talk.id
            return (
              <div
                key={talk.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  setDraggingId(talk.id)
                  onDragStart({ kind: 'talk', id: talk.id, hallId: null, dayId: talk.day_id, durationSlots: DEFAULT_UNASSIGNED_SLOTS })
                }}
                onDragEnd={() => {
                  setDraggingId(null)
                  onDragEnd()
                }}
                onClick={() => onEdit(talk)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border cursor-grab active:cursor-grabbing transition-opacity select-none ${
                  isDragging ? 'opacity-40' : ''
                } ${
                  color
                    ? `${color.bg} ${color.border} ${color.text} hover:opacity-80`
                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                {talk.title}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TracksPanel
// ---------------------------------------------------------------------------

function talkDurationSlots(talk: TalkItem): number {
  if (!talk.start_time || !talk.end_time) return 0
  const [sh, sm] = talk.start_time.split(':').map(Number)
  const [eh, em] = talk.end_time.split(':').map(Number)
  const durationMin = (eh * 60 + em) - (sh * 60 + sm)
  return durationMin / 40
}

function fmtSlots(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

function TracksPanel({ conference, collapsed, onCollapse }: { conference: Conference; collapsed: boolean; onCollapse: () => void }) {
  if (conference.tracks.length === 0) return null

  const allTalks = conference.days.flatMap((d) => d.talks).filter((t) => t.start_time != null)

  const usedByTrack = new Map<number, number>()
  for (const talk of allTalks) {
    if (talk.primary_track_id != null) {
      const tid = talk.primary_track_id
      usedByTrack.set(tid, (usedByTrack.get(tid) ?? 0) + talkDurationSlots(talk))
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200">
      <button
        onClick={onCollapse}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 rounded-2xl transition-colors"
      >
        <h3 className="text-sm font-semibold text-gray-700">Треки</h3>
        <span className={`text-gray-400 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}>▾</span>
      </button>

      {!collapsed && (
        <div className="space-y-3 px-5 pb-4">
          {conference.tracks.map((track, i) => {
            const c = TRACK_COLORS[i % TRACK_COLORS.length]
            const used = usedByTrack.get(track.id) ?? 0
            const free = track.slots - used
            const pct = track.slots > 0 ? Math.min(100, (used / track.slots) * 100) : 0

            return (
              <div key={track.id}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                  <span className={`text-sm font-medium ${c.text}`}>{track.name}</span>
                  <span className="text-xs text-gray-400 ml-auto">
                    <span className="font-semibold text-gray-700">{fmtSlots(used)}</span>
                    {' / '}{track.slots} сл.
                  </span>
                  <span className={`text-xs font-semibold w-20 text-right ${free < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {free >= 0 ? '+' : ''}{fmtSlots(free)} своб.
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-red-500' : c.dot}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DayGrid
// ---------------------------------------------------------------------------

interface DayGridProps {
  day: DayDetails
  halls: Hall[]
  tracks: Track[]
  dragOver: DragOver
  dragItem: DragItem | null
  onAddTalk: (h: Hall, startTime: string, endTime: string) => void
  onAddBreak: (h: Hall, startTime: string, endTime: string) => void
  onEditTalk: (t: TalkItem, h: Hall) => void
  onEditBreak: (b: BreakItem, h: Hall) => void
  onDeleteTalk: (t: TalkItem) => void
  onDeleteBreak: (b: BreakItem) => void
  onDeleteHall: (h: Hall) => void
  onDragStart: (item: DragItem) => void
  onDragEnd: () => void
  onSlotDragOver: (hallId: number, dayId: number, slot: number) => void
  onSlotDrop: (hallId: number, dayId: number, slot: number) => void
}

function DayGrid({ day, halls, tracks, dragOver, dragItem, onAddTalk, onAddBreak, onEditTalk, onEditBreak, onDeleteTalk, onDeleteBreak, onDeleteHall, onDragStart, onDragEnd, onSlotDragOver, onSlotDrop }: DayGridProps) {
  const trackIndexMap = new Map(tracks.map((t, i) => [t.id, i]))
  const [collapsed, setCollapsed] = useState(false)
  if (halls.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 mb-3 group"
      >
        <span className={`text-gray-400 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}>▾</span>
        <h2 className="text-base font-semibold text-gray-700 capitalize group-hover:text-gray-900">{formatDate(day.date)}</h2>
      </button>

      {!collapsed && <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Hall headers */}
        <div className="flex border-b border-gray-200">
          <div className="w-14 shrink-0" /> {/* time gutter */}
          {halls.map((hall) => (
            <div key={hall.id} className="flex-1 min-w-[160px] border-l border-gray-200 px-3 py-2">
              <div className="flex items-center justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{hall.name}</p>
                  <p className="text-xs text-gray-400">{hall.capacity} мест</p>
                </div>
                <button
                  onClick={() => onDeleteHall(hall)}
                  className="text-gray-300 hover:text-red-500 transition-colors shrink-0 text-xs"
                  title="Удалить зал"
                >✕</button>
              </div>
            </div>
          ))}
        </div>

        {/* Grid body */}
        <div className="flex overflow-x-auto">
          {/* Time column */}
          <div className="w-14 shrink-0 select-none">
            {SLOTS.map((slot) => (
              <div
                key={slot.index}
                style={{ height: SLOT_H }}
                className={`border-b flex items-start justify-end pr-2 pt-0.5 ${slot.isHour ? 'border-gray-200' : 'border-gray-100'}`}
              >
                <span className={`text-xs leading-none ${slot.isHour ? 'text-gray-500 font-medium' : 'text-gray-300'}`}>
                  {formatSlotTime(slot.totalMin)}
                </span>
              </div>
            ))}
          </div>

          {/* Hall columns */}
          {halls.map((hall) => {
            const isDropTarget = dragOver?.hallId === hall.id && dragOver?.dayId === day.id
            const ghostSlot = isDropTarget ? dragOver!.slot : null

            return (
              <div
                key={hall.id}
                className="flex-1 min-w-[160px] border-l border-gray-200 relative"
                style={{ height: TOTAL_SLOTS * SLOT_H }}
              >
                {/* Slot cells — drop targets + add buttons */}
                {SLOTS.map((slot) => {
                  const startTime = formatSlotTime(slot.totalMin)
                  const endTime = formatSlotTime(Math.min(slot.totalMin + 2 * SLOT_MIN, GRID_END))
                  const breakEndTime = formatSlotTime(Math.min(slot.totalMin + SLOT_MIN, GRID_END))
                  return (
                    <div
                      key={slot.index}
                      style={{ height: SLOT_H, top: slot.index * SLOT_H }}
                      className={`absolute w-full border-b group/slot ${slot.isHour ? 'border-gray-200' : 'border-gray-100'}`}
                      onDragOver={(e) => { e.preventDefault(); onSlotDragOver(hall.id, day.id, slot.index) }}
                      onDrop={(e) => { e.preventDefault(); onSlotDrop(hall.id, day.id, slot.index) }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover/slot:opacity-100 transition-opacity pointer-events-none">
                        <button
                          className="pointer-events-auto px-1.5 py-0.5 text-xs text-blue-600 bg-white border border-blue-200 rounded hover:bg-blue-50 transition-colors shadow-sm"
                          onClick={(e) => { e.stopPropagation(); onAddTalk(hall, startTime, endTime) }}
                        >+ Доклад</button>
                        <button
                          className="pointer-events-auto px-1.5 py-0.5 text-xs text-amber-600 bg-white border border-amber-200 rounded hover:bg-amber-50 transition-colors shadow-sm"
                          onClick={(e) => { e.stopPropagation(); onAddBreak(hall, startTime, breakEndTime) }}
                        >+ Перерыв</button>
                      </div>
                    </div>
                  )
                })}

                {/* Ghost preview */}
                {ghostSlot !== null && dragItem && (
                  <div
                    className="absolute left-1 right-1 rounded-lg pointer-events-none z-10 opacity-50 border-2 border-dashed border-blue-400 bg-blue-100"
                    style={{
                      top: Math.min(ghostSlot, TOTAL_SLOTS - dragItem.durationSlots) * SLOT_H + 2,
                      height: dragItem.durationSlots * SLOT_H - 4,
                    }}
                  />
                )}

                {/* Talks */}
                {day.talks
                  .filter((t) => t.hall_id === hall.id && t.start_time != null && t.end_time != null)
                  .map((talk) => {
                    const s = timeToSlot(talk.start_time!)
                    const e = timeToSlot(talk.end_time!)
                    if (s >= TOTAL_SLOTS || e <= 0) return null
                    return (
                      <TalkCard
                        key={talk.id}
                        talk={talk}
                        dayId={day.id}
                        startSlot={Math.max(0, s)}
                        durationSlots={Math.min(TOTAL_SLOTS, e) - Math.max(0, s)}
                        trackColorIndex={talk.primary_track_id != null ? (trackIndexMap.get(talk.primary_track_id) ?? null) : null}
                        tracks={tracks}
                        trackIndexMap={trackIndexMap}
                        onEdit={() => onEditTalk(talk, hall)}
                        onDelete={onDeleteTalk}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                      />
                    )
                  })}

                {/* Breaks */}
                {day.breaks
                  .filter((b) => b.hall_id === hall.id)
                  .map((br) => {
                    const s = timeToSlot(br.start_time)
                    const e = timeToSlot(br.end_time)
                    if (s >= TOTAL_SLOTS || e <= 0) return null
                    return (
                      <BreakCard
                        key={br.id}
                        br={br}
                        dayId={day.id}
                        startSlot={Math.max(0, s)}
                        durationSlots={Math.min(TOTAL_SLOTS, e) - Math.max(0, s)}
                        onEdit={() => onEditBreak(br, hall)}
                        onDelete={onDeleteBreak}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                      />
                    )
                  })}
              </div>
            )
          })}
        </div>
      </div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

// Default talk color when no track assigned
const DEFAULT_TALK = { bg: 'bg-blue-100', border: 'border-blue-300', hoverBorder: 'hover:border-blue-400', text: 'text-blue-900', sub: 'text-blue-500', del: 'text-blue-300' }

const TALK_COLORS = [
  { bg: 'bg-violet-100', border: 'border-violet-300', hoverBorder: 'hover:border-violet-400', text: 'text-violet-900', sub: 'text-violet-500', del: 'text-violet-300' },
  { bg: 'bg-emerald-100', border: 'border-emerald-300', hoverBorder: 'hover:border-emerald-400', text: 'text-emerald-900', sub: 'text-emerald-600', del: 'text-emerald-300' },
  { bg: 'bg-orange-100', border: 'border-orange-300', hoverBorder: 'hover:border-orange-400', text: 'text-orange-900', sub: 'text-orange-500', del: 'text-orange-300' },
  { bg: 'bg-pink-100', border: 'border-pink-300', hoverBorder: 'hover:border-pink-400', text: 'text-pink-900', sub: 'text-pink-500', del: 'text-pink-300' },
  { bg: 'bg-teal-100', border: 'border-teal-300', hoverBorder: 'hover:border-teal-400', text: 'text-teal-900', sub: 'text-teal-600', del: 'text-teal-300' },
  { bg: 'bg-indigo-100', border: 'border-indigo-300', hoverBorder: 'hover:border-indigo-400', text: 'text-indigo-900', sub: 'text-indigo-500', del: 'text-indigo-300' },
  { bg: 'bg-rose-100', border: 'border-rose-300', hoverBorder: 'hover:border-rose-400', text: 'text-rose-900', sub: 'text-rose-500', del: 'text-rose-300' },
  { bg: 'bg-cyan-100', border: 'border-cyan-300', hoverBorder: 'hover:border-cyan-400', text: 'text-cyan-900', sub: 'text-cyan-600', del: 'text-cyan-300' },
]

interface TalkCardProps {
  talk: TalkItem
  dayId: number
  startSlot: number
  durationSlots: number
  trackColorIndex: number | null
  tracks: Track[]
  trackIndexMap: Map<number, number>
  onEdit: () => void
  onDelete: (t: TalkItem) => void
  onDragStart: (item: DragItem) => void
  onDragEnd: () => void
}

function TalkCard({ talk, dayId, startSlot, durationSlots, trackColorIndex, tracks, trackIndexMap, onEdit, onDelete, onDragStart, onDragEnd }: TalkCardProps) {
  const dragging = useRef(false)
  const c = trackColorIndex !== null ? TALK_COLORS[trackColorIndex % TALK_COLORS.length] : DEFAULT_TALK

  const primaryTrack = talk.primary_track_id != null ? tracks.find((t) => t.id === talk.primary_track_id) : null
  const additionalTracks = talk.track_ids
    .filter((id) => id !== talk.primary_track_id)
    .map((id) => tracks.find((t) => t.id === id))
    .filter(Boolean) as Track[]

  const hasTracks = primaryTrack != null || additionalTracks.length > 0

  return (
    <div
      draggable
      onDragStart={(e) => {
        dragging.current = true
        e.dataTransfer.effectAllowed = 'move'
        onDragStart({ kind: 'talk', id: talk.id, hallId: talk.hall_id!, dayId, durationSlots })
      }}
      onDragEnd={() => {
        onDragEnd()
        setTimeout(() => { dragging.current = false }, 0)
      }}
      onClick={() => { if (!dragging.current) onEdit() }}
      className={`absolute left-1 right-1 ${c.bg} border ${c.border} rounded-lg px-2 py-1 overflow-hidden cursor-pointer active:opacity-50 z-10 group ${c.hoverBorder} transition-colors`}
      style={{ top: startSlot * SLOT_H + 2, height: durationSlots * SLOT_H - 4 }}
    >
      <div className="flex items-start justify-between gap-1">
        <p className={`text-xs font-semibold ${c.text} leading-tight truncate`}>{talk.title}</p>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(talk) }}
          onMouseDown={(e) => e.stopPropagation()}
          className={`${c.del} hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 leading-none text-base`}
        >✕</button>
      </div>
      <p className={`text-xs ${c.sub} leading-none mt-0.5`}>
        {formatTime(talk.start_time!)}–{formatTime(talk.end_time!)}
      </p>
      {hasTracks && (
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          {primaryTrack && (() => {
            const idx = trackIndexMap.get(primaryTrack.id) ?? 0
            const pc = TRACK_COLORS[idx % TRACK_COLORS.length]
            return (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium leading-none ${pc.bg} ${pc.text} border ${pc.border} truncate max-w-full`}>
                {primaryTrack.name}
              </span>
            )
          })()}
          {additionalTracks.map((t) => {
            const idx = trackIndexMap.get(t.id) ?? 0
            const dc = TRACK_COLORS[idx % TRACK_COLORS.length]
            return (
              <span key={t.id} title={t.name} className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs leading-none ${dc.bg} ${dc.text} border ${dc.border} truncate max-w-[80px]`}>
                {t.name}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface BreakCardProps {
  br: BreakItem
  dayId: number
  startSlot: number
  durationSlots: number
  onEdit: () => void
  onDelete: (b: BreakItem) => void
  onDragStart: (item: DragItem) => void
  onDragEnd: () => void
}

function BreakCard({ br, dayId, startSlot, durationSlots, onEdit, onDelete, onDragStart, onDragEnd }: BreakCardProps) {
  const dragging = useRef(false)

  return (
    <div
      draggable
      onDragStart={(e) => {
        dragging.current = true
        e.dataTransfer.effectAllowed = 'move'
        onDragStart({ kind: 'break', id: br.id, hallId: br.hall_id, dayId, durationSlots })
      }}
      onDragEnd={() => {
        onDragEnd()
        setTimeout(() => { dragging.current = false }, 0)
      }}
      onClick={() => { if (!dragging.current) onEdit() }}
      className="absolute left-1 right-1 bg-amber-100 border border-amber-300 rounded-lg px-2 py-1 overflow-hidden cursor-pointer active:opacity-50 z-10 group hover:border-amber-400 transition-colors"
      style={{ top: startSlot * SLOT_H + 2, height: durationSlots * SLOT_H - 4 }}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold text-amber-900 leading-tight">Перерыв</p>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(br) }}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-amber-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 leading-none text-base"
        >✕</button>
      </div>
      <p className="text-xs text-amber-600 leading-none mt-0.5">
        {formatTime(br.start_time)}–{formatTime(br.end_time)}
      </p>
    </div>
  )
}
