import { useEffect, useRef } from 'react'
import {
	Chart,
	LineElement,
	PointElement,
	LineController,
	CategoryScale,
	LinearScale,
	Filler,
	Tooltip,
} from 'chart.js'
import { shortLabel } from './App'

Chart.register(
	LineElement,
	PointElement,
	LineController,
	CategoryScale,
	LinearScale,
	Filler,
	Tooltip
)

export default function StatsChart({ slice, metrics }) {
	const ref = useRef(null)
	const instance = useRef(null)

	useEffect(() => {
		if (!ref.current) return
		if (instance.current) instance.current.destroy()

		const datasets = metrics.map(m => ({
			label: m.label,
			data: slice.map(d => d[m.key]),
			borderColor: m.lineColor,
			backgroundColor: m.key === 'ativos' ? 'rgba(43,199,0,0.07)' : 'transparent',
			borderWidth: m.thick ? 3 : 2,
			pointRadius: 4,
			fill: m.key === 'ativos',
			tension: 0.3,
		}))

		instance.current = new Chart(ref.current, {
			type: 'line',
			data: {
				labels: slice.map(d => shortLabel(d.date)),
				datasets,
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: {
					y: {
						ticks: { font: { size: 11 }, color: '#888780' },
						grid: { color: 'rgba(136,135,128,0.15)' },
					},
					x: {
						ticks: { font: { size: 11 }, color: '#888780', autoSkip: false, maxRotation: 0 },
						grid: { display: false },
					},
				},
			},
		})

		return () => {
			if (instance.current) instance.current.destroy()
		}
	}, [slice, metrics])

	return (
		<div style={{ position: 'relative', width: '100%', height: '240px', marginTop: '1rem' }}>
			<canvas ref={ref} role='img' aria-label='Gráfico de linha com evolução diária' />
		</div>
	)
}
