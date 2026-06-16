import { useEffect, useRef } from 'react'
import { Chart, LineElement, PointElement, LineController, CategoryScale, LinearScale, Filler, Tooltip } from 'chart.js'
import { shortLabel } from './App'

Chart.register(LineElement, PointElement, LineController, CategoryScale, LinearScale, Filler, Tooltip)

export default function StatsChart({ slice, metrics }) {
  const ref = useRef(null)
  const instance = useRef(null)

  useEffect(() => {
    if (!ref.current) return
    if (instance.current) instance.current.destroy()

    instance.current = new Chart(ref.current, {
      type: 'line',
      data: {
        labels: slice.map(d => shortLabel(d.date)),
        datasets: [
          { label: 'Membros ativos', data: slice.map(d => d.ativos), borderColor: '#2bc700', backgroundColor: 'rgba(43,199,0,0.07)', borderWidth: 2.5, pointRadius: 4, fill: true, tension: 0.3 },
          { label: 'Total de membros', data: slice.map(d => d.total), borderColor: '#888780', borderWidth: 1.5, pointRadius: 3, fill: false, tension: 0.3, borderDash: [2,5] },
          { label: 'Total newsletters', data: slice.map(d => d.newsletters), borderColor: '#e02b20', borderWidth: 2, pointRadius: 4, fill: false, tension: 0.3, borderDash: [8,4] },
          { label: 'Leitura na Íntegra', data: slice.map(d => d.integra), borderColor: '#ff7b00', borderWidth: 2, pointRadius: 4, fill: false, tension: 0.3, borderDash: [5,4] },
          { label: 'Novidades do Blog', data: slice.map(d => d.novidades), borderColor: '#fac400', borderWidth: 2, pointRadius: 4, fill: false, tension: 0.3, borderDash: [5,4] },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { font: { size: 11 }, color: '#888780' }, grid: { color: 'rgba(136,135,128,0.15)' } },
          x: { ticks: { font: { size: 11 }, color: '#888780', autoSkip: false, maxRotation: 0 }, grid: { display: false } }
        }
      }
    })

    return () => { if (instance.current) instance.current.destroy() }
  }, [slice])

  return (
    <div style={{ position: 'relative', width: '100%', height: '240px', marginTop: '1rem' }}>
      <canvas ref={ref} role="img" aria-label="Gráfico de linha com evolução semanal" />
    </div>
  )
}
