import React, { useState, useEffect, useRef } from 'react'
import type { Conference, DayDetails, Hall, Track, TalkItem, BreakItem, ScheduleVersion, KaitenSettings, KaitenBoardConfig, KaitenSpace, KaitenBoard, KaitenColumn, KaitenCardField } from '../types'
import { getConference, updateConference } from '../api/conferences'
import {
  createHall, deleteHall,
  createUnassignedTalk, updateTalk, deleteTalk,
  createBreak, updateBreak, deleteBreak,
  generateSchedule, getSchedulePrompt, saveSchedulePrompt, getScheduleVersions, activateScheduleVersion, deleteScheduleVersion,
  fillScheduleVersion, createManualVersion, removeVersionPlacement, exportScheduleExcel,
  updateVersionPlacement, addVersionPlacement,
} from '../api/schedule'
import {
  getKaitenSettings, saveKaitenSettings,
  getKaitenSpaces, getKaitenBoards, getKaitenColumns,
  getKaitenCardFields, importKaitenTalks,
} from '../api/kaiten'
import type { KaitenSettingsInput } from '../api/kaiten'
import HallForm from '../components/HallForm'
import TalkForm from '../components/TalkForm'
import BreakForm from '../components/BreakForm'
import ConfirmDialog from '../components/ConfirmDialog'

// ---------------------------------------------------------------------------
// Grid constants
// ---------------------------------------------------------------------------

const SLOT_H = 40           // px per 20-minute slot
const GRID_START = 10 * 60  // 10:00 in minutes from midnight
const GRID_END = 18 * 60    // 18:00 in minutes from midnight
const SLOT_MIN = 20
const TOTAL_SLOTS = (GRID_END - GRID_START) / SLOT_MIN  // 30

const SLOTS = Array.from({ length: TOTAL_SLOTS }, (_, i) => {
  const totalMin = GRID_START + i * SLOT_MIN
  return {
    index: i,
    totalMin,
    isHour: totalMin % 60 === 0,
    // slot whose border-b IS the hour mark (the :40 slot just before each :00)
    isPreHour: (totalMin + SLOT_MIN) % 60 === 0,
  }
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

export default function SchedulePage({ conferenceId }: Props) {
  const [conference, setConference] = useState<Conference | null>(null)
  const [loading, setLoading] = useState(true)
  const [dropError, setDropError] = useState('')

  const [tracksCollapsed, setTracksCollapsed] = useState(false)
  const [unassignedCollapsed, setUnassignedCollapsed] = useState(false)
  const [versions, setVersions] = useState<ScheduleVersion[]>([])
  const [activeVersionId, setActiveVersionId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  const [showHallForm, setShowHallForm] = useState(false)
  const [deletingHall, setDeletingHall] = useState<Hall | null>(null)
  const [addingTalkFor, setAddingTalkFor] = useState<{ hall: Hall; dayId: number; startTime: string; endTime: string } | null>(null)
  const [addingBreakFor, setAddingBreakFor] = useState<{ hall: Hall; dayId: number; startTime: string; endTime: string } | null>(null)
  const [addingUnassignedTalk, setAddingUnassignedTalk] = useState(false)
  const [editingTalk, setEditingTalk] = useState<{ talk: TalkItem; hall: Hall | null } | null>(null)
  const [editingBreak, setEditingBreak] = useState<{ br: BreakItem; hall: Hall } | null>(null)
  const [addingTrack, setAddingTrack] = useState(false)
  const [deletingTalk, setDeletingTalk] = useState<TalkItem | null>(null)
  const [confirmDeleteAllUnassigned, setConfirmDeleteAllUnassigned] = useState(false)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState<string | null>(null)
  const [llmProvider, setLlmProvider] = useState<string>(
    () => localStorage.getItem('llmProvider') ?? 'yandex'
  )

  const dragItemRef = useRef<DragItem | null>(null)
  const modalOpenRef = useRef(false)
  const [dragOver, setDragOver] = useState<DragOver>(null)

  // "Working" version: explicitly selected tab, or the DB-active version
  const workingVersionId = activeVersionId ?? versions.find((v) => v.is_active)?.id ?? null
  const workingVersion = workingVersionId !== null
    ? (versions.find((v) => v.id === workingVersionId) ?? null)
    : null

  const fetchAll = async () => {
    const [conf, vers] = await Promise.all([
      getConference(conferenceId),
      getScheduleVersions(conferenceId).catch(() => [] as ScheduleVersion[]),
    ])
    setConference(conf)
    setVersions(vers)
    setLoading(false)
  }

  const refresh = async () => {
    setConference(await getConference(conferenceId))
  }

  const refreshVersions = async () => {
    const vers = await getScheduleVersions(conferenceId).catch(() => [] as ScheduleVersion[])
    setVersions(vers)
  }

  useEffect(() => { fetchAll() }, []) // eslint-disable-line

  // Keep modalOpenRef in sync so the SSE handler can read it without being a dependency
  useEffect(() => {
    modalOpenRef.current = !!(addingTalkFor || addingBreakFor || editingTalk || editingBreak ||
      showHallForm || deletingHall || addingUnassignedTalk)
  }, [addingTalkFor, addingBreakFor, editingTalk, editingBreak, showHallForm, deletingHall, addingUnassignedTalk])

  // SSE auto-refresh — reconnects only when conferenceId changes, not on every modal toggle
  useEffect(() => {
    const es = new EventSource(`/api/conferences/${conferenceId}/events`, { withCredentials: true })
    es.onmessage = (e) => {
      if (e.data !== 'update') return
      if (!dragItemRef.current && !modalOpenRef.current) refresh()
    }
    return () => es.close()
  }, [conferenceId]) // eslint-disable-line

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

  const handleOpenGenerateModal = async () => {
    if (generatePrompt === null && conference) {
      const data = await getSchedulePrompt(conference.id).catch(() => ({ prompt: '' }))
      setGeneratePrompt(data.prompt)
    }
    setShowGenerateModal(true)
  }

  const handleProviderChange = (provider: string) => {
    setLlmProvider(provider)
    localStorage.setItem('llmProvider', provider)
  }

  const handleGenerate = async (prompt?: string) => {
    if (!conference) return
    setShowGenerateModal(false)
    setGenerating(true)
    setGenerateError('')
    if (prompt !== undefined) {
      await saveSchedulePrompt(conference.id, prompt).catch(() => {})
    }
    try {
      let resultVersion: ScheduleVersion
      if (activeVersionId !== null) {
        resultVersion = await fillScheduleVersion(conference.id, activeVersionId, llmProvider)
      } else {
        resultVersion = await generateSchedule(conference.id, prompt, llmProvider)
      }
      const vers = await getScheduleVersions(conference.id).catch(() => [] as ScheduleVersion[])
      setVersions(vers)
      setActiveVersionId(resultVersion.id)
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Ошибка генерации')
    } finally {
      setGenerating(false)
    }
  }

  const handleCreateManualVersion = async () => {
    if (!conference) return
    const newVersion = await createManualVersion(conference.id)
    const vers = await getScheduleVersions(conference.id).catch(() => [] as ScheduleVersion[])
    setVersions(vers)
    setActiveVersionId(newVersion.id)
  }

  const handleActivateVersion = async (versionId: number) => {
    if (!conference) return
    await activateScheduleVersion(conference.id, versionId)
    await Promise.all([refresh(), refreshVersions()])
    setActiveVersionId(null)
  }

  const handleDeleteVersion = async (versionId: number) => {
    if (!conference) return
    await deleteScheduleVersion(conference.id, versionId)
    const vers = await getScheduleVersions(conference.id).catch(() => [] as ScheduleVersion[])
    setVersions(vers)
    if (activeVersionId === versionId) {
      setActiveVersionId(vers[0]?.id ?? null)
    }
  }

  const handleAddTrack = async (name: string, slots: number) => {
    if (!conference) return
    const existingTracks = conference.tracks.map((t) => ({ name: t.name, slots: t.slots }))
    await updateConference(conference.id, { tracks: [...existingTracks, { name, slots }] })
    await refresh()
    setAddingTrack(false)
  }

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

  const handleAddTalk = async (data: { title: string; primary_track_id: number | null; track_ids: number[]; speaker_name?: string | null; speaker_level?: string | null; description?: string | null; talk_format?: string | null; duration_minutes?: number; relevance?: number | null; novelty?: number | null; applicability?: number | null; mass_appeal?: number | null; speaker_experience?: number | null }) => {
    if (!conference || !addingTalkFor || !workingVersionId) return
    const talk = await createUnassignedTalk(conference.id, data)
    const updated = await addVersionPlacement(conference.id, workingVersionId, {
      talk_id: talk.id,
      hall_id: addingTalkFor.hall.id,
      day_id: addingTalkFor.dayId,
      start_time: addingTalkFor.startTime,
      end_time: addingTalkFor.endTime,
    })
    setVersions((v) => v.map((ver) => ver.id === updated.id ? updated : ver))
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

  const handleCreateUnassignedTalk = async (data: { title: string; primary_track_id: number | null; track_ids: number[]; speaker_name?: string | null; speaker_level?: string | null; description?: string | null; duration_minutes?: number; relevance?: number | null; novelty?: number | null; applicability?: number | null; mass_appeal?: number | null; speaker_experience?: number | null }) => {
    if (!conference) return
    await createUnassignedTalk(conference.id, data)
    await refresh()
  }

  const handleEditTalk = async (data: { title: string; primary_track_id: number | null; track_ids: number[]; speaker_name?: string | null; speaker_level?: string | null; description?: string | null; talk_format?: string | null; duration_minutes?: number; relevance?: number | null; novelty?: number | null; applicability?: number | null; mass_appeal?: number | null; speaker_experience?: number | null }) => {
    if (!editingTalk) return
    await updateTalk(editingTalk.talk.id, data)
    setEditingTalk(null)
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

  // In the schedule grid: remove from working version (moves to "Нужно распределить")
  const handleUnassignTalk = async (talk: TalkItem) => {
    if (!conference || !workingVersionId) return
    try {
      await removeVersionPlacement(conference.id, workingVersionId, talk.id)
      await refreshVersions()
    } catch (err) {
      setDropError(err instanceof Error ? err.message : 'Ошибка')
      await refreshVersions()
    }
  }

  // From the unassigned panel: permanent delete with confirm
  const handleDeleteTalkPermanently = async () => {
    if (!deletingTalk) return
    await deleteTalk(deletingTalk.id)
    setDeletingTalk(null)
    await refresh()
  }

  const handleDeleteAllUnassigned = async () => {
    if (!conference) return
    const placedIds = new Set(workingVersion?.placements.map((p) => p.talk_id) ?? [])
    const unassigned = conference.days.flatMap((d) => d.talks).filter((t) => !placedIds.has(t.id))
    await Promise.all(unassigned.map((t) => deleteTalk(t.id)))
    setConfirmDeleteAllUnassigned(false)
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
    if (!item || !conference) return

    const slot = Math.min(targetSlot, TOTAL_SLOTS - item.durationSlots)
    const newStart = slotToTimeStr(slot)
    const newEnd = slotToTimeStr(slot + item.durationSlots)

    try {
      if (item.kind === 'talk') {
        if (!workingVersionId) {
          setDropError('Сначала выберите или создайте версию расписания')
          return
        }
        if (item.hallId == null) {
          const updated = await addVersionPlacement(conference.id, workingVersionId, {
            talk_id: item.id,
            hall_id: targetHallId,
            day_id: targetDayId,
            start_time: newStart,
            end_time: newEnd,
          })
          setVersions((v) => v.map((ver) => ver.id === updated.id ? updated : ver))
        } else {
          const updated = await updateVersionPlacement(conference.id, workingVersionId, item.id, {
            hall_id: targetHallId,
            day_id: targetDayId,
            start_time: newStart,
            end_time: newEnd,
          })
          setVersions((v) => v.map((ver) => ver.id === updated.id ? updated : ver))
        }
      } else {
        const dayChanged = targetDayId !== item.dayId
        await updateBreak(item.id, {
          hall_id: targetHallId,
          start_time: newStart,
          end_time: newEnd,
          ...(dayChanged && { day_id: targetDayId }),
        })
        await refresh()
      }
    } catch (err) {
      setDropError(err instanceof Error ? err.message : 'Ошибка при перемещении')
      await refreshVersions()
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
      <main className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 space-y-6 sm:space-y-10">
        {dropError && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 flex justify-between items-center">
            <span>{dropError}</span>
            <button onClick={() => setDropError('')} className="text-red-400 hover:text-red-600 ml-4">✕</button>
          </div>
        )}

        <TracksPanel conference={conference} collapsed={tracksCollapsed} onCollapse={() => setTracksCollapsed((v) => !v)} onAddTrack={() => setAddingTrack(true)} />

        <KaitenPanel conferenceId={conferenceId} onImported={fetchAll} />

        {/* Version tabs */}
        <ScheduleVersionTabs
          conferenceId={conferenceId}
          versions={versions}
          activeVersionId={activeVersionId}
          onSelect={setActiveVersionId}
          onActivate={handleActivateVersion}
          onDelete={handleDeleteVersion}
          onCreateVersion={handleCreateManualVersion}
        />

        <UnassignedTalksPanel
          conference={conference}
          activeVersion={workingVersion}
          collapsed={unassignedCollapsed}
          onCollapse={() => setUnassignedCollapsed((v) => !v)}
          onAdd={() => setAddingUnassignedTalk(true)}
          onDeleteAll={() => setConfirmDeleteAllUnassigned(true)}
          onEdit={(talk) => setEditingTalk({ talk, hall: null })}
          onDelete={(talk) => setDeletingTalk(talk)}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          generating={generating}
          onGenerate={handleOpenGenerateModal}
          onEditPrompt={handleOpenGenerateModal}
          generateError={generateError}
          onClearGenerateError={() => setGenerateError('')}
        />

        {conference.halls.length === 0 && (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
            <p className="text-gray-400 mb-3">Залов пока нет</p>
            <button onClick={() => setShowHallForm(true)} className="text-sm font-medium text-blue-600 hover:underline">
              + Добавить зал
            </button>
          </div>
        )}

        {buildVersionDays(conference, workingVersion).map((day) => (
          <DayGrid
            key={day.id}
            day={day}
            halls={conference.halls}
            tracks={conference.tracks}
            dragOver={dragOver}
            dragItem={dragItemRef.current}
            onAddHall={() => setShowHallForm(true)}
            onAddTalk={(hall, startTime, endTime) => {
              if (!workingVersionId) { setDropError('Сначала выберите или создайте версию расписания'); return }
              setAddingTalkFor({ hall, dayId: day.id, startTime, endTime })
            }}
            onAddBreak={(hall, startTime, endTime) => setAddingBreakFor({ hall, dayId: day.id, startTime, endTime })}
            onEditTalk={(talk, hall) => setEditingTalk({ talk, hall })}
            onEditBreak={(br, hall) => setEditingBreak({ br, hall })}
            onDeleteTalk={handleUnassignTalk}
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
          days={conference.days}
          initialTitle={editingTalk.talk.title}
          initialPrimaryTrackId={editingTalk.talk.primary_track_id}
          initialTrackIds={editingTalk.talk.track_ids}
          initialDayId={editingTalk.talk.day_id}
          initialHallId={editingTalk.hall?.id ?? null}
          initialSpeakerName={editingTalk.talk.speaker_name ?? ''}
          initialSpeakerLevel={editingTalk.talk.speaker_level ?? ''}
          initialSpeakerCompany={editingTalk.talk.speaker_company ?? ''}
          initialSpeakerPosition={editingTalk.talk.speaker_position ?? ''}
          initialSpeakerBio={editingTalk.talk.speaker_bio ?? ''}
          initialDescription={editingTalk.talk.description ?? ''}
          initialTalkFormat={editingTalk.talk.talk_format ?? ''}
          initialDurationMinutes={editingTalk.talk.duration_minutes ?? 40}
          initialRelevance={editingTalk.talk.relevance}
          initialNovelty={editingTalk.talk.novelty}
          initialApplicability={editingTalk.talk.applicability}
          initialMassAppeal={editingTalk.talk.mass_appeal}
          initialSpeakerExperience={editingTalk.talk.speaker_experience}
          onSubmit={handleEditTalk}
          onClose={() => setEditingTalk(null)}
        />
      )}
      {editingBreak && (
        <BreakForm
          mode="edit"
          hallName={editingBreak.hall.name}
          initialStartTime={formatTime(editingBreak.br.start_time)}
          initialEndTime={editingBreak.br.end_time ? formatTime(editingBreak.br.end_time) : ''}
          onSubmit={handleEditBreak}
          onClose={() => setEditingBreak(null)}
        />
      )}
      {deletingTalk && (
        <ConfirmDialog
          message={`Удалить доклад «${deletingTalk.title}»? Это действие необратимо.`}
          onConfirm={handleDeleteTalkPermanently}
          onCancel={() => setDeletingTalk(null)}
        />
      )}
      {confirmDeleteAllUnassigned && (
        <ConfirmDialog
          message="Удалить все нераспределённые доклады? Это действие необратимо."
          onConfirm={handleDeleteAllUnassigned}
          onCancel={() => setConfirmDeleteAllUnassigned(false)}
        />
      )}
      {addingTrack && <AddTrackModal onSubmit={handleAddTrack} onClose={() => setAddingTrack(false)} />}
      {showGenerateModal && conference && (
        <GenerateModal
          prompt={generatePrompt ?? ''}
          onPromptChange={setGeneratePrompt}
          provider={llmProvider}
          onProviderChange={handleProviderChange}
          onConfirm={() => handleGenerate(generatePrompt ?? undefined)}
          onSave={() => {
            saveSchedulePrompt(conference.id, generatePrompt ?? '').catch(() => {})
            setShowGenerateModal(false)
          }}
          onCancel={() => setShowGenerateModal(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

function buildVersionDays(conference: Conference, version: ScheduleVersion | null): DayDetails[] {
  if (!version) return conference.days.map((day) => ({ ...day, talks: [] }))
  const talkMap = new Map<number, TalkItem>()
  for (const day of conference.days) {
    for (const talk of day.talks) talkMap.set(talk.id, talk)
  }

  const placementsByDay = new Map<number, TalkItem[]>()
  for (const p of version.placements) {
    if (!placementsByDay.has(p.day_id)) placementsByDay.set(p.day_id, [])
    const orig = talkMap.get(p.talk_id)
    placementsByDay.get(p.day_id)!.push({
      id: p.talk_id,
      title: p.talk_title,
      day_id: p.day_id,
      hall_id: p.hall_id,
      start_time: p.start_time,
      end_time: p.end_time,
      primary_track_id: p.primary_track_id,
      track_ids: p.track_ids,
      speaker_name: orig?.speaker_name ?? null,
      speaker_level: orig?.speaker_level ?? null,
      speaker_company: orig?.speaker_company ?? null,
      speaker_position: orig?.speaker_position ?? null,
      speaker_bio: orig?.speaker_bio ?? null,
      description: orig?.description ?? null,
      talk_format: orig?.talk_format ?? null,
      duration_minutes: orig?.duration_minutes ?? 40,
      relevance: orig?.relevance ?? null,
      novelty: orig?.novelty ?? null,
      applicability: orig?.applicability ?? null,
      mass_appeal: orig?.mass_appeal ?? null,
      speaker_experience: orig?.speaker_experience ?? null,
    })
  }

  return conference.days.map((day) => ({
    ...day,
    talks: placementsByDay.get(day.id) ?? [],
  }))
}

function AddTrackModal({ onSubmit, onClose }: { onSubmit: (name: string, slots: number) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('')
  const [slots, setSlots] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    try { await onSubmit(name.trim(), Number(slots) || 0) } finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Новый трек</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            required autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Название трека"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="number" min={0} value={slots} onChange={(e) => setSlots(e.target.value)}
            placeholder="Количество слотов"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Отмена</button>
            <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {submitting ? 'Сохранение…' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// KaitenPanel
// ---------------------------------------------------------------------------

const TALK_FIELDS: { id: string; label: string; required?: boolean }[] = [
  { id: 'title', label: 'Название', required: true },
  { id: 'speaker_name', label: 'Спикер' },
  { id: 'speaker_level', label: 'Уровень спикера' },
  { id: 'talk_format', label: 'Формат выступления' },
  { id: 'description', label: 'Описание' },
  { id: 'duration_minutes', label: 'Длительность (мин)' },
  { id: 'relevance', label: 'Актуальность (1–5)' },
  { id: 'novelty', label: 'Новизна (1–5)' },
  { id: 'applicability', label: 'Применимость (1–5)' },
  { id: 'mass_appeal', label: 'Массовость (1–5)' },
  { id: 'speaker_experience', label: 'Опыт спикера (1–5)' },
]

const DEFAULT_MAPPING: Record<string, string | null> = {
  title: 'title',
  speaker_name: 'responsible.full_name',
  speaker_level: null,
  talk_format: null,
  description: 'description',
  duration_minutes: null,
  relevance: null,
  novelty: null,
  applicability: null,
  mass_appeal: null,
  speaker_experience: null,
}

// Sub-component for adding a new board (space → board → column selector)
function AddBoardForm({
  conferenceId,
  onAdd,
  onCancel,
}: {
  conferenceId: number
  onAdd: (cfg: KaitenBoardConfig) => void
  onCancel: () => void
}) {
  const [spaces, setSpaces] = useState<KaitenSpace[]>([])
  const [boards, setBoards] = useState<KaitenBoard[]>([])
  const [columns, setColumns] = useState<KaitenColumn[]>([])
  const [cfg, setCfg] = useState<Partial<KaitenBoardConfig>>({})
  const [loadingSpaces, setLoadingSpaces] = useState(true)
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getKaitenSpaces(conferenceId)
      .then(setSpaces)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoadingSpaces(false))
  }, []) // eslint-disable-line

  const handleSpace = async (spaceId: number) => {
    const spaceName = spaces.find((s) => s.id === spaceId)?.title ?? ''
    setCfg({ space_id: spaceId, space_name: spaceName })
    setBoards([])
    setColumns([])
    setLoadingBoards(true)
    try {
      setBoards(await getKaitenBoards(conferenceId, spaceId))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoadingBoards(false)
    }
  }

  const handleBoard = async (boardId: number) => {
    const boardName = boards.find((b) => b.id === boardId)?.title ?? ''
    setCfg((prev) => ({ ...prev, board_id: boardId, board_name: boardName }))
    setColumns([])
    setLoadingColumns(true)
    try {
      setColumns(await getKaitenColumns(conferenceId, boardId))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoadingColumns(false)
    }
  }

  const handleColumn = (columnId: number) => {
    const columnName = columns.find((c) => c.id === columnId)?.title ?? ''
    onAdd({ ...cfg, column_id: columnId, column_name: columnName } as KaitenBoardConfig)
  }

  return (
    <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 space-y-2">
      <p className="text-xs font-medium text-blue-700">Новая доска</p>
      {loadingSpaces ? (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
          Загрузка пространств…
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs text-gray-500 mb-1">Пространство</label>
            <select
              value={cfg.space_id ?? ''}
              onChange={(e) => handleSpace(Number(e.target.value))}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              disabled={loadingBoards}
            >
              <option value="">— выберите —</option>
              {spaces.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
          {boards.length > 0 && (
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-gray-500 mb-1">Доска</label>
              <select
                value={cfg.board_id ?? ''}
                onChange={(e) => handleBoard(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                disabled={loadingColumns}
              >
                <option value="">— выберите —</option>
                {boards.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
              </select>
            </div>
          )}
          {loadingBoards && (
            <div className="flex items-center gap-1 text-xs text-gray-400 self-end pb-1.5">
              <span className="w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
              Загрузка досок…
            </div>
          )}
          {columns.length > 0 && (
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs text-gray-500 mb-1">Колонка</label>
              <select
                value={cfg.column_id ?? ''}
                onChange={(e) => handleColumn(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              >
                <option value="">— выберите —</option>
                {columns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
          )}
          {loadingColumns && (
            <div className="flex items-center gap-1 text-xs text-gray-400 self-end pb-1.5">
              <span className="w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
              Загрузка колонок…
            </div>
          )}
        </div>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Отмена</button>
    </div>
  )
}

function KaitenPanel({ conferenceId, onImported }: { conferenceId: number; onImported: () => void }) {
  const [settings, setSettings] = useState<KaitenSettings | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [cardFields, setCardFields] = useState<KaitenCardField[]>([])
  const [loadingFields, setLoadingFields] = useState(false)
  const [mapping, setMapping] = useState<Record<string, string | null>>(DEFAULT_MAPPING)
  const [addingBoard, setAddingBoard] = useState(false)
  const [savingMapping, setSavingMapping] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [importResult, setImportResult] = useState('')

  useEffect(() => {
    getKaitenSettings(conferenceId)
      .then((s) => {
        if (s) {
          setSettings(s)
          setMapping(s.field_mapping ?? DEFAULT_MAPPING)
        }
      })
      .catch(() => {})
  }, [conferenceId]) // eslint-disable-line

  const configuredBoards = settings?.boards ?? []
  const isConfigured = configuredBoards.some((b) => b.column_id)

  // Stable key for boards (board_ids joined) to avoid reference-equality issues in deps
  const boardIdsKey = configuredBoards.map((b) => b.board_id).join(',')

  const loadCardFields = async () => {
    setLoadingFields(true)
    setError('')
    try {
      const fields = await getKaitenCardFields(conferenceId)
      setCardFields(fields)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки полей Kaiten')
    } finally {
      setLoadingFields(false)
    }
  }

  useEffect(() => {
    if (!collapsed && boardIdsKey) {
      loadCardFields()
    }
  }, [collapsed, boardIdsKey]) // eslint-disable-line

  const saveSettings = async (boards: KaitenBoardConfig[], newMapping?: Record<string, string | null>) => {
    const payload: KaitenSettingsInput = {
      boards,
      field_mapping: newMapping ?? mapping,
    }
    const saved = await saveKaitenSettings(conferenceId, payload)
    setSettings(saved)
    return saved
  }

  const handleAddBoard = async (cfg: KaitenBoardConfig) => {
    setError('')
    try {
      const newBoards = [...configuredBoards, cfg]
      await saveSettings(newBoards)
      setAddingBoard(false)
      await loadCardFields()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
    }
  }

  const handleRemoveBoard = async (idx: number) => {
    setError('')
    try {
      const newBoards = configuredBoards.filter((_, i) => i !== idx)
      await saveSettings(newBoards)
      if (newBoards.length === 0) {
        setCardFields([])
      } else {
        await loadCardFields()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления')
    }
  }

  const handleSaveMapping = async (newMapping: Record<string, string | null>) => {
    if (!settings) return
    setSavingMapping(true)
    try {
      const saved = await saveSettings(configuredBoards, newMapping)
      setMapping(saved.field_mapping ?? DEFAULT_MAPPING)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения маппинга')
    } finally {
      setSavingMapping(false)
    }
  }

  const handleToggle = () => setCollapsed((v) => !v)

  const handleImport = async () => {
    setError('')
    setImportResult('')
    setImporting(true)
    try {
      const result = await importKaitenTalks(conferenceId, (job) => {
        if (job.status === 'running') setImportResult('Импортируем...')
      })
      if (result.status === 'error') {
        setError(result.error ?? 'Ошибка импорта')
      } else {
        const parts = []
        if (result.imported) parts.push(`загружено ${result.imported}`)
        if (result.updated) parts.push(`обновлено ${result.updated}`)
        setImportResult(parts.length ? parts.join(', ') : 'Нет новых карточек')
        onImported()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка импорта')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleToggle}
          className="flex items-center gap-2 flex-1 px-4 sm:px-5 py-3 sm:py-4 hover:bg-gray-50 rounded-l-2xl transition-colors text-left"
        >
          <span className="text-sm font-semibold text-gray-700">Kaiten</span>
          {isConfigured ? (
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Настроено" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" title="Не настроено" />
          )}
          {isConfigured && (
            <span className="text-xs text-gray-400">{configuredBoards.length} {configuredBoards.length === 1 ? 'доска' : configuredBoards.length < 5 ? 'доски' : 'досок'}</span>
          )}
          <span className={`text-gray-400 transition-transform duration-200 ml-1 ${collapsed ? '-rotate-90' : ''}`}>▾</span>
        </button>
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 sm:py-4 shrink-0">
          {isConfigured && (
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {importing ? (
                <>
                  <span className="w-3 h-3 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin shrink-0" />
                  Загрузка…
                </>
              ) : (
                <>↓ <span className="hidden sm:inline">Загрузить доклады</span><span className="sm:hidden">Загрузить</span></>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-3">
          {/* Configured boards list */}
          {configuredBoards.length > 0 && (
            <div className="space-y-1.5">
              {configuredBoards.map((b, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 text-xs">
                  <span className="text-gray-700 truncate">
                    {[b.space_name, b.board_name, b.column_name].filter(Boolean).join(' › ')}
                  </span>
                  <button
                    onClick={() => handleRemoveBoard(idx)}
                    className="text-gray-300 hover:text-red-500 transition-colors shrink-0 text-base leading-none"
                    title="Удалить"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add board form or button */}
          {addingBoard ? (
            <AddBoardForm
              conferenceId={conferenceId}
              onAdd={handleAddBoard}
              onCancel={() => setAddingBoard(false)}
            />
          ) : (
            <button
              onClick={() => setAddingBoard(true)}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              + Добавить доску
            </button>
          )}

          {/* Field mapping */}
          {loadingFields && (
            <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
              <span className="w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
              Загрузка полей Kaiten…
            </div>
          )}
          {!loadingFields && cardFields.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                <span className="text-xs font-medium text-gray-600">Маппинг полей</span>
                {savingMapping && (
                  <span className="w-3 h-3 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin" />
                )}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left px-3 py-1.5 text-gray-500 font-medium w-1/2">Поле доклада</th>
                    <th className="text-left px-3 py-1.5 text-gray-500 font-medium w-1/2">Поле Kaiten</th>
                  </tr>
                </thead>
                <tbody>
                  {TALK_FIELDS.map((tf) => (
                    <tr key={tf.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-1.5 text-gray-700">
                        {tf.label}
                        {tf.required && <span className="text-red-400 ml-0.5">*</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <select
                          value={mapping[tf.id] ?? ''}
                          onChange={(e) => {
                            const newMapping = { ...mapping, [tf.id]: e.target.value || null }
                            setMapping(newMapping)
                            handleSaveMapping(newMapping)
                          }}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                        >
                          {!tf.required && <option value="">— не маппить —</option>}
                          {cardFields.map((cf) => (
                            <option key={cf.id} value={cf.id}>{cf.name}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Error / result messages */}
          {error && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 flex justify-between items-center">
              <span>{error}</span>
              <button onClick={() => setError('')} className="text-amber-400 hover:text-amber-600 ml-2">✕</button>
            </div>
          )}
          {importResult && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700 flex justify-between items-center">
              <span>{importResult}</span>
              <button onClick={() => setImportResult('')} className="text-green-400 hover:text-green-600 ml-2">✕</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UnassignedTalksPanel
// ---------------------------------------------------------------------------

interface UnassignedTalksPanelProps {
  conference: Conference
  activeVersion: ScheduleVersion | null
  collapsed: boolean
  onCollapse: () => void
  onAdd?: () => void
  onDeleteAll?: () => void
  onEdit: (talk: TalkItem) => void
  onDelete: (talk: TalkItem) => void
  onDragStart: (item: DragItem) => void
  onDragEnd: () => void
  generating: boolean
  onGenerate: () => void
  onEditPrompt: () => void
  generateError: string
  onClearGenerateError: () => void
}

function UnassignedTalksPanel({ conference, activeVersion, collapsed, onCollapse, onAdd, onDeleteAll, onEdit, onDelete, onDragStart, onDragEnd, generating, onGenerate, onEditPrompt, generateError, onClearGenerateError }: UnassignedTalksPanelProps) {
  const allTalks = conference.days.flatMap((d) => d.talks)
  const placedIds = new Set(activeVersion?.placements.map((p) => p.talk_id) ?? [])
  const unassigned = allTalks.filter((t) => !placedIds.has(t.id))
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [filterText, setFilterText] = useState('')
  const [filterTrackId, setFilterTrackId] = useState<number | null>(null)
  const [filterFormat, setFilterFormat] = useState<string | null>(null)

  const formats = Array.from(new Set(unassigned.map((t) => t.talk_format).filter(Boolean))) as string[]

  const filtered = unassigned.filter((t) => {
    if (filterTrackId !== null && t.primary_track_id !== filterTrackId) return false
    if (filterFormat !== null && t.talk_format !== filterFormat) return false
    if (filterText) {
      const q = filterText.toLowerCase()
      if (!t.title.toLowerCase().includes(q) && !(t.speaker_name ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="bg-white rounded-2xl border border-gray-200">
      <div className="flex flex-wrap items-center">
        <button
          onClick={onCollapse}
          className="flex items-center gap-2 flex-1 px-4 sm:px-5 py-3 sm:py-4 hover:bg-gray-50 rounded-tl-2xl transition-colors text-left min-w-0"
        >
          <h3 className="text-sm font-semibold text-gray-700 whitespace-nowrap">Нужно распределить</h3>
          {unassigned.length > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full shrink-0">
              {unassigned.length}
            </span>
          )}
          <span className={`text-gray-400 transition-transform duration-200 ml-1 shrink-0 ${collapsed ? '-rotate-90' : ''}`}>▾</span>
        </button>
        <div className="flex items-center gap-2 px-4 sm:px-5 py-3 sm:py-4 flex-wrap justify-end">
          <button
            onClick={onGenerate}
            disabled={generating || unassigned.length === 0}
            className="flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            title={unassigned.length === 0 ? 'Нет докладов для распределения' : 'Сгенерировать расписание с помощью ИИ'}
          >
            {generating ? (
              <>
                <span className="w-3 h-3 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin shrink-0" />
                <span className="hidden sm:inline">Генерация…</span>
              </>
            ) : (
              <>✦ <span className="hidden sm:inline">Автораспределить</span></>
            )}
          </button>
          <button
            onClick={onEditPrompt}
            disabled={generating}
            className="text-gray-400 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Настроить промпт для ИИ-распределения"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
            </svg>
          </button>
          {onAdd && (
            <button
              onClick={onAdd}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
            >
              + <span className="hidden sm:inline">Добавить доклад</span><span className="sm:hidden">Доклад</span>
            </button>
          )}
          {onDeleteAll && unassigned.length > 0 && (
            <button
              onClick={onDeleteAll}
              className="text-xs text-red-500 hover:text-red-600 font-medium whitespace-nowrap"
              title="Удалить все нераспределённые доклады"
            >
              Удалить все
            </button>
          )}
        </div>
      </div>

      {generateError && (
        <div className="mx-5 mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex justify-between items-center">
          <span>{generateError}</span>
          <button onClick={onClearGenerateError} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {!collapsed && unassigned.length > 0 && (
        <div className="px-4 sm:px-5 pb-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Поиск по названию или спикеру…"
              className="flex-1 min-w-[180px] border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-gray-50"
            />
            {(filterText || filterTrackId !== null || filterFormat !== null) && (
              <button
                onClick={() => { setFilterText(''); setFilterTrackId(null); setFilterFormat(null) }}
                className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap"
              >
                Сбросить
              </button>
            )}
          </div>
          {conference.tracks.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {conference.tracks.map((t, idx) => {
                const c = TRACK_COLORS[idx % TRACK_COLORS.length]
                const active = filterTrackId === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFilterTrackId(active ? null : t.id)}
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                      active ? `${c.bg} ${c.border} ${c.text}` : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          )}
          {formats.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {formats.map((f) => {
                const active = filterFormat === f
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilterFormat(active ? null : f)}
                    className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                      active ? 'bg-gray-700 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    {f}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {!collapsed && (unassigned.length === 0 ? (
        <p className="text-xs text-gray-400 px-4 sm:px-5 pb-4">Все доклады распределены</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-gray-400 px-4 sm:px-5 pb-4">Нет совпадений</p>
      ) : (
        <div className="flex flex-wrap gap-2 px-4 sm:px-5 pb-4">
          {filtered.map((talk) => {
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
                  onDragStart({ kind: 'talk', id: talk.id, hallId: null, dayId: talk.day_id, durationSlots: Math.max(1, Math.round((talk.duration_minutes ?? 40) / SLOT_MIN)) })
                }}
                onDragEnd={() => {
                  setDraggingId(null)
                  onDragEnd()
                }}
                onClick={() => onEdit(talk)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border cursor-grab active:cursor-grabbing transition-opacity select-none ${
                  isDragging ? 'opacity-40' : ''
                } ${
                  color
                    ? `${color.bg} ${color.border} ${color.text} hover:opacity-80`
                    : 'bg-gray-50 border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                }`}
              >
                <span>{talk.title}</span>
                {talk.talk_format && (
                  <span className="shrink-0 text-xs opacity-60 font-normal">{talk.talk_format}</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(talk) }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500 leading-none shrink-0"
                  title="Удалить"
                >✕</button>
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

function TracksPanel({ conference, collapsed, onCollapse, onAddTrack }: { conference: Conference; collapsed: boolean; onCollapse: () => void; onAddTrack: () => void }) {
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
      <div className="flex items-center justify-between">
        <button onClick={onCollapse} className="flex items-center gap-2 flex-1 px-4 sm:px-5 py-3 sm:py-4 hover:bg-gray-50 rounded-tl-2xl transition-colors">
          <h3 className="text-sm font-semibold text-gray-700">Треки</h3>
          <span className={`text-gray-400 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}>▾</span>
        </button>
        <button onClick={onAddTrack} className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors shrink-0 whitespace-nowrap px-4 sm:px-5 py-3 sm:py-4">
          + <span className="hidden sm:inline">Добавить </span>Трек
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-3 px-4 sm:px-5 pb-4">
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
  readOnly?: boolean
  onAddHall: () => void
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
  onUnassignFromVersion?: (talkId: number) => void
}

function DayGrid({ day, halls, tracks, dragOver, dragItem, readOnly = false, onAddHall, onAddTalk, onAddBreak, onEditTalk, onEditBreak, onDeleteTalk, onDeleteBreak, onDeleteHall, onDragStart, onDragEnd, onSlotDragOver, onSlotDrop, onUnassignFromVersion }: DayGridProps) {
  const trackIndexMap = new Map(tracks.map((t, i) => [t.id, i]))
  const [collapsed, setCollapsed] = useState(false)
  if (halls.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 group min-w-0"
        >
          <span className={`text-gray-400 transition-transform duration-200 shrink-0 ${collapsed ? '-rotate-90' : ''}`}>▾</span>
          <h2 className="text-base font-semibold text-gray-700 capitalize group-hover:text-gray-900 truncate">{formatDate(day.date)}</h2>
        </button>
        {!readOnly && (
          <button
            onClick={onAddHall}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors whitespace-nowrap shrink-0 ml-3"
          >
            + <span className="hidden sm:inline">Добавить </span>Зал
          </button>
        )}
      </div>

      {!collapsed && <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        <div className="min-w-max">
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
                {!readOnly && (
                  <button
                    onClick={() => onDeleteHall(hall)}
                    className="text-gray-300 hover:text-red-500 transition-colors shrink-0 text-xs"
                    title="Удалить зал"
                  >✕</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Grid body */}
        <div className="flex">
          {/* Time column — each label sits 1px below its hour line */}
          <div className="relative w-14 shrink-0 select-none" style={{ height: TOTAL_SLOTS * SLOT_H }}>
            {SLOTS.map((slot) => (
              <span
                key={slot.index}
                className={`absolute right-2 text-xs leading-none ${slot.isHour ? 'text-gray-600 font-bold' : 'text-gray-300'}`}
                style={{ top: Math.max(0, slot.index * SLOT_H - 4) }}
              >
                {formatSlotTime(slot.totalMin)}
              </span>
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
                      className={`absolute w-full group/slot border-b ${slot.isPreHour ? 'border-gray-300' : 'border-gray-100'}`}
                      onDragOver={(e) => { if (!readOnly) { e.preventDefault(); onSlotDragOver(hall.id, day.id, slot.index) } }}
                      onDrop={(e) => { if (!readOnly) { e.preventDefault(); onSlotDrop(hall.id, day.id, slot.index) } }}
                    >
                      {!readOnly && (
                        <div className="absolute inset-0 flex items-center justify-center gap-1 opacity-0 group-hover/slot:opacity-100 transition-opacity pointer-events-none">
                          <button
                            className="pointer-events-auto px-1.5 py-0.5 text-sm font-medium text-blue-600 bg-white border border-blue-200 rounded hover:bg-blue-50 transition-colors shadow-sm"
                            onClick={(e) => { e.stopPropagation(); onAddTalk(hall, startTime, endTime) }}
                          >+ Доклад</button>
                          <button
                            className="pointer-events-auto px-1.5 py-0.5 text-sm font-medium text-amber-600 bg-white border border-amber-200 rounded hover:bg-amber-50 transition-colors shadow-sm"
                            onClick={(e) => { e.stopPropagation(); onAddBreak(hall, startTime, breakEndTime) }}
                          >+ Перерыв</button>
                        </div>
                      )}
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

                {/* Keynote broadcasts from other halls */}
                {day.talks
                  .filter((t) => t.speaker_level === 'keynote' && t.hall_id !== hall.id && t.start_time != null && t.end_time != null)
                  .map((talk) => {
                    const s = timeToSlot(talk.start_time!)
                    const e = timeToSlot(talk.end_time!)
                    if (s >= TOTAL_SLOTS || e <= 0) return null
                    return (
                      <BroadcastCard
                        key={`broadcast-${talk.id}`}
                        talk={talk}
                        startSlot={Math.max(0, s)}
                        durationSlots={Math.min(TOTAL_SLOTS, e) - Math.max(0, s)}
                      />
                    )
                  })}

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
                        readOnly={readOnly}
                        onEdit={() => onEditTalk(talk, hall)}
                        onDelete={onDeleteTalk}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onUnassignFromVersion={onUnassignFromVersion}
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
                        readOnly={readOnly}
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
  readOnly?: boolean
  onEdit: () => void
  onDelete: (t: TalkItem) => void
  onDragStart: (item: DragItem) => void
  onDragEnd: () => void
  onUnassignFromVersion?: (talkId: number) => void
}

function TalkCard({ talk, dayId, startSlot, durationSlots, trackColorIndex, tracks, trackIndexMap, readOnly = false, onEdit, onDelete, onDragStart, onDragEnd, onUnassignFromVersion }: TalkCardProps) {
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
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : (e) => {
        dragging.current = true
        e.dataTransfer.effectAllowed = 'move'
        onDragStart({ kind: 'talk', id: talk.id, hallId: talk.hall_id!, dayId, durationSlots })
      }}
      onDragEnd={readOnly ? undefined : () => {
        onDragEnd()
        setTimeout(() => { dragging.current = false }, 0)
      }}
      onClick={() => { if (!readOnly && !dragging.current) onEdit() }}
      className={`absolute left-1 right-1 ${c.bg} border ${c.border} rounded-lg px-2 py-1 overflow-hidden z-10 group ${c.hoverBorder} transition-colors ${readOnly ? 'cursor-default' : 'cursor-pointer active:opacity-50'}`}
      style={{ top: startSlot * SLOT_H + 2, height: durationSlots * SLOT_H - 4 }}
    >
      {talk.speaker_level === 'keynote' && (
        <span className="inline-block mb-1 px-1.5 py-0.5 rounded text-xs font-bold bg-indigo-950 text-indigo-200 leading-none">
          🎤 Keynote
        </span>
      )}
      <div className="flex items-start justify-between gap-1">
        <p className={`text-xs font-semibold ${c.text} leading-tight break-words min-w-0`}>{talk.title}</p>
        {!readOnly && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(talk) }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`${c.del} hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 leading-none text-base`}
          >✕</button>
        )}
        {readOnly && onUnassignFromVersion && (
          <button
            onClick={(e) => { e.stopPropagation(); onUnassignFromVersion(talk.id) }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-gray-300 hover:text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 leading-none text-sm"
            title="Вернуть в нераспределённые"
          >↩</button>
        )}
      </div>
      <p className={`text-xs ${c.sub} leading-none mt-0.5`}>
        {formatTime(talk.start_time!)}–{formatTime(talk.end_time!)}
        {talk.talk_format && <span className="ml-1 opacity-70">· {talk.talk_format}</span>}
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

function BroadcastCard({ talk, startSlot, durationSlots }: {
  talk: TalkItem
  startSlot: number
  durationSlots: number
}) {
  return (
    <div
      className="absolute left-1 right-1 bg-indigo-950 border border-dashed border-indigo-600 rounded-lg px-2 py-1 overflow-hidden opacity-80 cursor-default z-[5]"
      style={{ top: startSlot * SLOT_H + 2, height: durationSlots * SLOT_H - 4 }}
    >
      <p className="text-xs font-medium text-indigo-300 leading-none mb-0.5">📺 Трансляция</p>
      <p className="text-xs font-semibold text-indigo-100 leading-tight break-words">{talk.title}</p>
      <p className="text-xs text-indigo-400 leading-none mt-0.5">
        {formatTime(talk.start_time!)}–{formatTime(talk.end_time!)}
      </p>
    </div>
  )
}

interface BreakCardProps {
  br: BreakItem
  dayId: number
  startSlot: number
  durationSlots: number
  readOnly?: boolean
  onEdit: () => void
  onDelete: (b: BreakItem) => void
  onDragStart: (item: DragItem) => void
  onDragEnd: () => void
}

// ---------------------------------------------------------------------------
// ScheduleVersionTabs
// ---------------------------------------------------------------------------

interface ScheduleVersionTabsProps {
  conferenceId: number
  versions: ScheduleVersion[]
  activeVersionId: number | null
  onSelect: (id: number | null) => void
  onActivate: (id: number) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onCreateVersion: () => Promise<void>
}

function ScheduleVersionTabs({ conferenceId, versions, activeVersionId, onSelect, onActivate, onDelete, onCreateVersion }: ScheduleVersionTabsProps) {
  const [activating, setActivating] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const handleActivate = async (id: number) => {
    setActivating(id)
    setError('')
    try { await onActivate(id) }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
    finally { setActivating(null) }
  }

  const handleDelete = async (id: number) => {
    setDeleting(id)
    setError('')
    try { await onDelete(id) }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
    finally { setDeleting(null) }
  }

  const handleCreate = async () => {
    setCreating(true)
    setError('')
    try { await onCreateVersion() }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
    finally { setCreating(false) }
  }

  const handleExport = async () => {
    setExporting(true)
    setError('')
    try { await exportScheduleExcel(conferenceId, activeVersionId) }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка экспорта') }
    finally { setExporting(false) }
  }

  const activeVersion = versions.find((v) => v.id === activeVersionId) ?? null

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-end gap-1 overflow-x-auto pb-0 scrollbar-hide">
        {/* "Final schedule" tab */}
        <button
          onClick={() => onSelect(null)}
          className={`shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-xl border border-b-0 transition-colors ${
            activeVersionId === null
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-sm'
              : 'bg-emerald-50/60 border-transparent text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'
          }`}
        >
          <span className="text-emerald-500 text-xs">★</span>
          Финальное расписание
        </button>

        {versions.map((v) => {
          const isActive = activeVersionId === v.id
          return (
            <button
              key={v.id}
              onClick={() => onSelect(v.id)}
              className={`shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t-xl border border-b-0 transition-colors ${
                isActive
                  ? 'bg-white border-gray-200 text-gray-900 shadow-sm'
                  : 'bg-gray-100 border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span className="text-purple-500 text-xs">✦</span>
              <span>{v.name}</span>
              {v.is_active && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Применена" />}
              <span className="text-xs text-gray-400 ml-0.5">{v.placement_count}</span>
            </button>
          )
        })}

        {/* Create version button */}
        <button
          onClick={handleCreate}
          disabled={creating}
          className="shrink-0 px-3 py-2 text-sm font-medium rounded-t-xl border border-b-0 border-transparent text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 transition-colors"
          title="Создать версию расписания (снимок финального)"
        >
          {creating ? '…' : '+ Версия'}
        </button>
      </div>

      {/* Active version banner */}
      {activeVersion && (
        <div className="bg-white border border-gray-200 rounded-b-2xl rounded-tr-2xl px-4 sm:px-5 py-3 flex flex-col sm:flex-row items-start gap-3">
          <div className="flex-1 min-w-0">
            {activeVersion.summary && (
              <p className="text-xs text-gray-500 line-clamp-2">{activeVersion.summary}</p>
            )}
            {!activeVersion.summary && (
              <p className="text-xs text-gray-400">Предпросмотр версии — read-only</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!activeVersion.is_active && (
              <button
                onClick={() => handleActivate(activeVersion.id)}
                disabled={activating === activeVersion.id}
                className="px-3 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {activating === activeVersion.id ? 'Применяем…' : '✓ Применить версию'}
              </button>
            )}
            {activeVersion.is_active && (
              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-lg">Применена</span>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-3 py-1.5 text-xs font-medium text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50 disabled:opacity-50 transition-colors whitespace-nowrap"
              title="Скачать расписание в Excel"
            >
              {exporting ? '…' : '↓ Excel'}
            </button>
            <button
              onClick={() => handleDelete(activeVersion.id)}
              disabled={deleting === activeVersion.id}
              className="px-3 py-1.5 text-xs font-medium text-red-500 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {deleting === activeVersion.id ? '…' : 'Удалить'}
            </button>
          </div>
        </div>
      )}
      {activeVersionId === null && (
        <div className="bg-emerald-50 border border-emerald-200 border-t-0 rounded-b-2xl px-5 py-2.5 flex justify-end">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 transition-colors whitespace-nowrap bg-white"
            title="Скачать финальное расписание в Excel"
          >
            {exporting ? '…' : '↓ Экспорт в Excel'}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700 flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}
    </div>
  )
}

function BreakCard({ br, dayId, startSlot, durationSlots, readOnly = false, onEdit, onDelete, onDragStart, onDragEnd }: BreakCardProps) {
  const dragging = useRef(false)

  return (
    <div
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : (e) => {
        dragging.current = true
        e.dataTransfer.effectAllowed = 'move'
        onDragStart({ kind: 'break', id: br.id, hallId: br.hall_id, dayId, durationSlots })
      }}
      onDragEnd={readOnly ? undefined : () => {
        onDragEnd()
        setTimeout(() => { dragging.current = false }, 0)
      }}
      onClick={() => { if (!readOnly && !dragging.current) onEdit() }}
      className={`absolute left-1 right-1 bg-amber-100 border border-amber-300 rounded-lg px-2 py-1 overflow-hidden z-10 group hover:border-amber-400 transition-colors ${readOnly ? 'cursor-default' : 'cursor-pointer active:opacity-50'}`}
      style={{ top: startSlot * SLOT_H + 2, height: durationSlots * SLOT_H - 4 }}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold text-amber-900 leading-tight">Перерыв</p>
        {!readOnly && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(br) }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-amber-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 leading-none text-base"
          >✕</button>
        )}
      </div>
      <p className="text-xs text-amber-600 leading-none mt-0.5">
        {formatTime(br.start_time)}–{formatTime(br.end_time)}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GenerateModal
// ---------------------------------------------------------------------------

const LLM_PROVIDERS = [
  { id: 'yandex', label: 'YandexGPT', hint: 'YANDEX_API_KEY + YANDEX_FOLDER_ID' },
  { id: 'gigachat', label: 'GigaChat', hint: 'GIGACHAT_CREDENTIALS' },
]

function GenerateModal({ prompt, onPromptChange, provider, onProviderChange, onConfirm, onSave, onCancel }: {
  prompt: string
  onPromptChange: (v: string) => void
  provider: string
  onProviderChange: (v: string) => void
  onConfirm: () => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-5 sm:p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-gray-900">Критерии распределения</h3>
        <p className="text-xs text-gray-500 -mt-2">
          Инструкции для ИИ. Инструкция по формату JSON добавляется автоматически. Промпт сохраняется для каждой конференции.
        </p>

        {/* Provider selector */}
        <div>
          <p className="text-xs font-medium text-gray-600 mb-1.5">Модель ИИ</p>
          <div className="flex gap-2">
            {LLM_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => onProviderChange(p.id)}
                title={p.hint}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  provider === p.id
                    ? 'bg-purple-600 border-purple-600 text-white'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            Требуется: <span className="font-mono">{LLM_PROVIDERS.find((p) => p.id === provider)?.hint}</span>
          </p>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={10}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y"
        />
        <div className="flex justify-between gap-3">
          <button
            onClick={onSave}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-50 transition-colors"
            title="Сохранить промпт без запуска генерации"
          >
            Сохранить
          </button>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={onConfirm}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors"
            >
              ✦ Запустить
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
