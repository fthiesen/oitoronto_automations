import { useState, useEffect } from 'react'
import StatsChart from './StatsChart'
import ComparisonBlock from './WeekBlock'

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function shortLabel(dateStr) {
	const parts = dateStr.split('-')
	const day = parseInt(parts[2])
	const month = parseInt(parts[1]) - 1
	return day + ' ' + MONTHS[month]
}

export const METRICS = [
	{ key: 'total', label: 'Total de membros', color: '#6B6A63', lineColor: '#888780', thick: true },
	{ key: 'ativos', label: 'Membros ativos', color: '#1e9e00', lineColor: '#2bc700', thick: true },
	{
		key: 'newsletters',
		label: 'Membros em Newsletters',
		color: '#2D7FFF',
		lineColor: '#2D7FFF',
		thick: false,
	},
	{
		key: 'integra',
		label: 'Membros - Leitura na Íntegra',
		color: '#6c63d1',
		lineColor: '#7F77DD',
		thick: false,
	},
	{
		key: 'novidades',
		label: 'Membros - Novidades do Blog',
		color: '#9579c2',
		lineColor: '#B19CD9',
		thick: false,
	},
]

export default function App() {
	const [data, setData] = useState([])
	const [from, setFrom] = useState(0)
	const [to, setTo] = useState(0)
	const [error, setError] = useState(null)

	useEffect(() => {
		fetch('./data.json')
			.then(r => r.json())
			.then(d => {
				setData(d)
				const lastIndex = d.length - 1
				const sevenDaysAgoIndex = Math.max(0, lastIndex - 6)
				setFrom(sevenDaysAgoIndex)
				setTo(lastIndex)
			})
			.catch(() => setError('Não foi possível carregar os dados.'))
	}, [])

	if (error) return <p style={{ color: '#e02b20', padding: '2rem' }}>{error}</p>
	if (!data.length) return <p style={{ padding: '2rem', color: '#888' }}>Carregando...</p>

	const LEGACY_POSTS = 1605
	const slice = data.slice(from, to + 1)
	const firstDay = slice[0]
	const lastDay = slice[slice.length - 1]
	const ghostPosts = data[data.length - 1]?.posts
	const totalPosts = ghostPosts != null ? LEGACY_POSTS + ghostPosts : null

	return (
		<div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
				<div>
					<h1 style={{ fontSize: '18px', fontWeight: 500, marginBottom: '0.25rem' }}>
						OiToronto Stats
					</h1>
					<p style={{ fontSize: '12px', color: '#888', marginBottom: '0.75rem' }}>Atualizado diariamente à meia-noite</p>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
						<select
							value={from}
							onChange={e => {
								const val = parseInt(e.target.value)
								setFrom(val)
								if (val > to) setTo(val)
							}}
							style={{
								fontSize: '12px',
								padding: '4px 8px',
								borderRadius: '6px',
								border: '0.5px solid #ccc',
								background: '#fff',
							}}
						>
							{data.map((d, i) => (
								<option key={i} value={i}>
									{shortLabel(d.date)}
								</option>
							))}
						</select>
						<span style={{ fontSize: '12px', color: '#888' }}>até</span>
						<select
							value={to}
							onChange={e => {
								const val = parseInt(e.target.value)
								setTo(val)
								if (val < from) setFrom(val)
							}}
							style={{
								fontSize: '12px',
								padding: '4px 8px',
								borderRadius: '6px',
								border: '0.5px solid #ccc',
								background: '#fff',
							}}
						>
							{data.map((d, i) => (
								<option key={i} value={i} disabled={i < from}>
									{shortLabel(d.date)}
								</option>
							))}
						</select>
					</div>
				</div>
				{totalPosts != null && (
					<div
						style={{
							borderRadius: '8px',
							padding: '0.75rem 1rem',
							background: '#c0392b',
							color: '#fff',
							textAlign: 'right',
							flexShrink: 0,
						}}
					>
						<p style={{ fontSize: '11px', margin: '0 0 4px', opacity: 0.9 }}>Posts publicados desde 2009</p>
						<p style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 3px' }}>
							{totalPosts.toLocaleString('pt-BR')}
						</p>
						<p style={{ fontSize: '11px', margin: 0, opacity: 0.7 }}>
							1.605 + {ghostPosts.toLocaleString('pt-BR')}
						</p>
					</div>
				)}
			</div>

			<ComparisonBlock firstDay={firstDay} lastDay={lastDay} metrics={METRICS} />

			<StatsChart slice={slice} metrics={METRICS} />

			<div
				style={{
					display: 'flex',
					flexWrap: 'wrap',
					gap: '16px',
					marginTop: '12px',
					fontSize: '12px',
					color: '#666',
				}}
			>
				{METRICS.map(m => (
					<span key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
						<svg width='24' height='10'>
							<line
								x1='0'
								y1='5'
								x2='24'
								y2='5'
								stroke={m.lineColor}
								strokeWidth={m.thick ? 3 : 2}
							/>
							<circle cx='12' cy='5' r='3' fill={m.lineColor} />
						</svg>
						{m.label}
					</span>
				))}
			</div>
		</div>
	)
}
