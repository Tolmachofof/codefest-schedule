import { useRef, ChangeEvent } from 'react'

interface Props {
  value: string // "HH:MM"
  onChange: (value: string) => void
  className?: string
}

export default function TimeInput({ value, onChange, className = '' }: Props) {
  const [hh, mm] = value ? value.split(':') : ['', '']
  const mmRef = useRef<HTMLInputElement>(null)

  const handleHourChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 2)
    onChange(`${v}:${mm ?? ''}`)
    if (v.length === 2) {
      mmRef.current?.focus()
      mmRef.current?.select()
    }
  }

  const handleMinChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 2)
    onChange(`${hh ?? ''}:${v}`)
  }

  return (
    <div className={`flex items-center border border-gray-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="ЧЧ"
        maxLength={2}
        value={hh ?? ''}
        onChange={handleHourChange}
        className="w-6 text-center text-sm bg-transparent outline-none"
      />
      <span className="text-gray-400 text-sm select-none mx-0.5">:</span>
      <input
        ref={mmRef}
        type="text"
        inputMode="numeric"
        placeholder="ММ"
        maxLength={2}
        value={mm ?? ''}
        onChange={handleMinChange}
        className="w-6 text-center text-sm bg-transparent outline-none"
      />
    </div>
  )
}
