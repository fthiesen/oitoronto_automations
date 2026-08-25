import { useState, useEffect, useRef } from 'react'

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

// 'YYYY-MM-DD' -> Date local (evita o deslocamento de fuso do Date.parse)
function parseDate(str) {
	const [y, m, d] = str.split('-').map(Number)
	return new Date(y, m - 1, d)
}

function toKey(date) {
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return date.getFullYear() + '-' + m + '-' + d
}

function label(str) {
	const d = parseDate(str)
	return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]
}

// Grade de 6 semanas cobrindo o mês, começando no domingo
function buildGrid(year, month) {
	const first = new Date(year, month, 1)
	const start = new Date(year, month, 1 - first.getDay())
	// A partir de `start` (que costuma cair no mes anterior), nao de `month`:
	// usar `month` aqui desloca a grade inteira em um mes.
	return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}

export default function DateRangePicker({ dates, from, to, onChange }) {
	const [open, setOpen] = useState(false)
	const [pending, setPending] = useState(null) // início da seleção em andamento
	const [hover, setHover] = useState(null)
	const [cursor, setCursor] = useState(() => parseDate(dates[to] || dates[dates.length - 1]))
	const ref = useRef(null)

	useEffect(() => {
		if (!open) return
		const onDocDown = e => {
			if (ref.current && !ref.current.contains(e.target)) setOpen(false)
		}
		const onKey = e => e.key === 'Escape' && setOpen(false)
		document.addEventListener('mousedown', onDocDown)
		document.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('mousedown', onDocDown)
			document.removeEventListener('keydown', onKey)
		}
	}, [open])

	const indexOf = new Map(dates.map((d, i) => [d, i]))
	const min = parseDate(dates[0])
	const max = parseDate(dates[dates.length - 1])

	const year = cursor.getFullYear()
	const month = cursor.getMonth()
	const canPrev = new Date(year, month, 1) > min
	const canNext = new Date(year, month + 1, 1) <= max

	function pick(key) {
		if (pending == null) {
			setPending(key)
			setHover(null)
			return
		}
		const a = indexOf.get(pending)
		const b = indexOf.get(key)
		onChange(Math.min(a, b), Math.max(a, b))
		setPending(null)
		setHover(null)
		setOpen(false)
	}

	// Faixa a destacar: a seleção confirmada, ou a prévia enquanto se escolhe o fim
	const previewEnd = pending != null ? hover || pending : null
	const [lo, hi] =
		pending != null
			? [Math.min(indexOf.get(pending), indexOf.get(previewEnd)), Math.max(indexOf.get(pending), indexOf.get(previewEnd))]
			: [from, to]

	return (
		<div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
			<button
				onClick={() => {
					setPending(null)
					setCursor(parseDate(dates[to]))
					setOpen(o => !o)
				}}
				style={{
					fontSize: '12px',
					padding: '5px 10px',
					borderRadius: '6px',
					border: '0.5px solid #ccc',
					background: '#fff',
					color: '#1a1a1a',
					cursor: 'pointer',
					display: 'flex',
					alignItems: 'center',
					gap: '6px',
				}}
			>
				<span>📅</span>
				{label(dates[from])} <span style={{ color: '#888' }}>até</span> {label(dates[to])}
			</button>

			{open && (
				<div
					style={{
						position: 'absolute',
						top: 'calc(100% + 6px)',
						left: 0,
						zIndex: 20,
						background: '#fff',
						border: '0.5px solid #ccc',
						borderRadius: '8px',
						boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
						padding: '10px',
						width: '252px',
					}}
				>
					<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
						<NavButton disabled={!canPrev} onClick={() => setCursor(new Date(year, month - 1, 1))}>
							‹
						</NavButton>
						<span style={{ fontSize: '12px', fontWeight: 500 }}>
							{MONTHS[month]} {year}
						</span>
						<NavButton disabled={!canNext} onClick={() => setCursor(new Date(year, month + 1, 1))}>
							›
						</NavButton>
					</div>

					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
						{WEEKDAYS.map((w, i) => (
							<span key={i} style={{ fontSize: '10px', color: '#aaa', textAlign: 'center', padding: '2px 0' }}>
								{w}
							</span>
						))}

						{buildGrid(year, month).map(day => {
							const key = toKey(day)
							const idx = indexOf.get(key)
							const available = idx != null && day.getMonth() === month
							const inRange = available && idx >= lo && idx <= hi
							const isEdge = available && (idx === lo || idx === hi)

							return (
								<button
									key={key}
									disabled={!available}
									onClick={() => pick(key)}
									onMouseEnter={() => available && setHover(key)}
									style={{
										fontSize: '11px',
										height: '28px',
										border: 'none',
										borderRadius: isEdge ? '6px' : inRange ? '0' : '6px',
										cursor: available ? 'pointer' : 'default',
										background: isEdge ? '#1a1a1a' : inRange ? '#e8e8e4' : 'transparent',
										color: isEdge ? '#fff' : available ? '#1a1a1a' : '#d8d8d4',
										fontWeight: isEdge ? 600 : 400,
									}}
								>
									{day.getDate()}
								</button>
							)
						})}
					</div>

					<p style={{ fontSize: '10px', color: '#888', marginTop: '8px' }}>
						{pending == null ? 'Escolha a data inicial' : 'Escolha a data final'}
					</p>
				</div>
			)}
		</div>
	)
}

function NavButton({ disabled, onClick, children }) {
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			style={{
				border: 'none',
				background: 'transparent',
				fontSize: '16px',
				lineHeight: 1,
				padding: '2px 8px',
				cursor: disabled ? 'default' : 'pointer',
				color: disabled ? '#ddd' : '#666',
			}}
		>
			{children}
		</button>
	)
}
