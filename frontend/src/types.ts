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
  hall_id: number | null
  start_time: string | null
  end_time: string | null
  primary_track_id: number | null
  track_ids: number[]
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

export interface Conference {
  id: number
  name: string
  city: string
  start_date: string
  end_date: string
  tracks: Track[]
  halls: Hall[]
  days: DayDetails[]
}
