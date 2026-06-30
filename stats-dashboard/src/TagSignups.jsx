import { useState, useEffect } from 'react'

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const TAG_COLORS = {
	'Imigração': '#b03a2e',
	'Trabalho': '#2D7FFF',
	'Moradia': '#ca6f1e',
	'Dinheiro': '#1e8449',
	'Educação': '#7d3c98',
	'Saúde': '#148f77',
	'Manchetes': '#2c3e50',
	'Turismo': '#d35400',
	'Lazer': '#17a589',
	'Papelada': '#616a6b',
	'Transporte': '#1a5276',
	'Experiência': '#6c3483',
	'Paladar': '#cb4335',
	'Cinema': '#d4ac0d',
	'Esporte': '#1d8348',
	'Música': '#a93226',
	'Notícia': '#2471a3',
	'Depoimento': '#6e2f1a',
	'N/A': '#909497',
}

function monthLabel(ym) {
	const [y, m] = ym.split('-')
	return `${MONTHS_PT[parseInt(m) - 1]} ${y}`
}

export default function TagSignups() {
	const [data, setData] = useState([])
	const [postsPerTag, setPostsPerTag] = useState({})
	const [fromMonth, setFromMonth] = useState('')
	const [toMonth, setToMonth] = useState('')
	const [error, setError] = useState(null)

	useEffect(() => {
		Promise.all([
			fetch('./signups-by-tag.json').then(r => r.json()),
			fetch('./posts-per-tag.json').then(r => r.json()),
		])
			.then(([signups, posts]) => {
				setData(signups)
				setPostsPerTag(posts)
				const months = [...new Set(signups.map(e => e.date.substring(0, 7)))].sort()
				setFromMonth(months[0])
				setToMonth(months[months.length - 1])
			})
			.catch(() => setError('Não foi possível carregar os dados de cadastros por tag.'))
	}, [])

	if (error) return <p style={{ color: '#e02b20', fontSize: '12px' }}>{error}</p>
	if (!data.length) return null

	const months = [...new Set(data.map(e => e.date.substring(0, 7)))].sort()

	const filtered = data.filter(d => {
		const m = d.date.substring(0, 7)
		return m >= fromMonth && m <= toMonth
	})

	const totals = {}
	filtered.forEach(d => {
		Object.entries(d.tags).forEach(([tag, count]) => {
			totals[tag] = (totals[tag] || 0) + count
		})
	})

	const sorted = Object.entries(totals)
		.map(([tag, signups]) => {
			const posts = postsPerTag[tag]
			const ratio = posts ? signups / posts : null
			return { tag, signups, posts, ratio }
		})
		.sort((a, b) => {
			if (a.ratio !== null && b.ratio !== null) return b.ratio - a.ratio
			if (a.ratio !== null) return -1
			if (b.ratio !== null) return 1
			return b.signups - a.signups
		})

	const total = Object.values(totals).reduce((s, c) => s + c, 0)

	const selectStyle = {
		fontSize: '12px',
		padding: '4px 8px',
		borderRadius: '6px',
		border: '0.5px solid #ccc',
		background: '#fff',
	}

	return (
		<div style={{ marginTop: '2.5rem' }}>
			<div
				style={{
					display: 'flex',
					justifyContent: 'space-between',
					alignItems: 'flex-start',
					marginBottom: '1rem',
					flexWrap: 'wrap',
					gap: '8px',
				}}
			>
				<div>
					<h2 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 0.25rem' }}>
						Cadastros por tag
					</h2>
					<p style={{ fontSize: '12px', color: '#888', margin: 0 }}>
						Total no período: {total.toLocaleString('pt-BR')}
					</p>
				</div>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
					<select
						value={fromMonth}
						onChange={e => {
							if (e.target.value <= toMonth) setFromMonth(e.target.value)
						}}
						style={selectStyle}
					>
						{months.map(m => (
							<option key={m} value={m}>
								{monthLabel(m)}
							</option>
						))}
					</select>
					<span style={{ fontSize: '12px', color: '#888' }}>até</span>
					<select
						value={toMonth}
						onChange={e => {
							if (e.target.value >= fromMonth) setToMonth(e.target.value)
						}}
						style={selectStyle}
					>
						{months.map(m => (
							<option key={m} value={m}>
								{monthLabel(m)}
							</option>
						))}
					</select>
				</div>
			</div>

			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
					gap: '8px',
				}}
			>
				{sorted.map(({ tag, signups, posts, ratio }) => (
					<div
						key={tag}
						style={{
							borderRadius: '8px',
							padding: '0.75rem',
							background: TAG_COLORS[tag] || '#888',
							color: '#fff',
						}}
					>
						<p
							style={{
								fontSize: '11px',
								margin: '0 0 3px',
								opacity: 0.9,
								whiteSpace: 'nowrap',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
							}}
						>
							{tag}
						</p>
						{ratio !== null ? (
							<>
								<p style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 2px' }}>
									{ratio.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
								</p>
								<p style={{ fontSize: '11px', margin: '0 0 2px', opacity: 0.9 }}>
									membros por post
								</p>
								<p style={{ fontSize: '11px', margin: 0, opacity: 0.6 }}>
									{signups} cadastros · {posts} posts
								</p>
							</>
						) : (
							<>
								<p style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 2px' }}>
									{signups.toLocaleString('pt-BR')}
								</p>
								<p style={{ fontSize: '11px', margin: 0, opacity: 0.7 }}>
									cadastros
								</p>
							</>
						)}
					</div>
				))}
			</div>
		</div>
	)
}
