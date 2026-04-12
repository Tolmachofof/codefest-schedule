export interface Track {
  id: number
  name: string
  slots: number
}

export interface Hall {
  id: number
  name: string
  capacity: number
}

export interface TalkItem {
  id: number
  title: string
  day_id: number
  /** Populated by buildVersionDays from TalkPlacement; undefined when read directly from API */
  hall_id?: number | null
  /** Populated by buildVersionDays from TalkPlacement; undefined when read directly from API */
  start_time?: string | null
  /** Populated by buildVersionDays from TalkPlacement; undefined when read directly from API */
  end_time?: string | null
  primary_track_id: number | null
  track_ids: number[]
  speaker_name: string | null
  speaker_level: string | null
  speaker_company: string | null
  speaker_position: string | null
  speaker_bio: string | null
  description: string | null
  talk_format: string | null
  duration_minutes: number
  relevance: number | null
  novelty: number | null
  applicability: number | null
  mass_appeal: number | null
  speaker_experience: number | null
}

export interface BreakItem {
  id: number
  hall_id: number
  start_time: string
  end_time: string
}

export interface DayDetails {
  id: number
  date: string
  talks: TalkItem[]
  breaks: BreakItem[]
}

export interface ConferenceSummary {
  id: number
  name: string
  city: string
  start_date: string
  end_date: string
  tracks: Track[]
  halls: Hall[]
}

export interface Conference extends ConferenceSummary {
  days: DayDetails[]
}

export interface TalkPlacement {
  id: number
  talk_id: number
  talk_title: string
  day_id: number
  day_date: string
  hall_id: number
  hall_name: string
  start_time: string
  end_time: string
  reasoning: string | null
  primary_track_id: number | null
  track_ids: number[]
}

export interface ScheduleVersion {
  id: number
  name: string
  created_at: string
  updated_at: string
  is_active: boolean
  summary: string | null
  placement_count: number
  placements: TalkPlacement[]
}

export interface KaitenBoardConfig {
  space_id: number | null
  board_id: number | null
  column_id: number | null
  space_name: string | null
  board_name: string | null
  column_name: string | null
}

export interface KaitenSettings {
  boards: KaitenBoardConfig[]
  field_mapping?: Record<string, string | null> | null
}

export interface KaitenSpace { id: number; title: string }
export interface KaitenBoard { id: number; title: string }
export interface KaitenColumn { id: number; title: string }
export interface KaitenCardField { id: string; name: string }
