import { useState, useEffect } from 'react'
import StatsChart from './StatsChart'
import WeekBlock from './WeekBlock'

const MONTHS = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']

export function shortLabel(dateStr) {
  const parts = dateStr.split('-')
  const day = parseInt(parts[2])
  const month = parseInt(parts[1]) - 1
  return day + ' ' + MONTHS[month]
}

export const METRICS = [
  { key: 'ativos',      label: 'Membros ativos',     color: '#2bc700', textColor: '#1e8a00' },
  { key: 'total',       label: 'Total de membros',   color: '#888780', textColor: '#5F5E5A' },
  { key: 'newsletters', label: 'Total newsletters',  color: '#e02b20', textColor: '#a31e16' },
  { key: 'integra',     label: 'Leitura na Íntegra', color: '#ff7b00', textColor: '#b35600' },
  { key: 'novidades',   label: 'Novidades do Blog',  color: '#fac400', textColor: '#a07d00' },
]

export default function App() {
  const [data, setData] = useState([])
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(0)
  const [applied, setApplied] = useState({ from: 0, to: 0 })
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('./data.json')
      .then(r => r.json())
      .then(d => {
        setData(d)
        setFrom(0)
        setTo(d.length - 1)
        setApplied({ from: 0, to: d.length - 1 })
      })
      .catch(() => setError('Não foi possível carregar os dados.'))
  }, [])

  if (error) return <p style={{ color: '#e02b20', padding: '2rem' }}>{error}</p>
  if (!data.length) return <p style={{ padding: '2rem', color: '#888' }}>Carregando...</p>

  const slice = data.slice(applied.from, applied.to + 1)

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 500, marginBottom: '0.25rem' }}>OiToronto Stats</h1>
        <p style={{ fontSize: '12px', color: '#888' }}>Atualizado toda segunda-feira</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <select
          value={from}
          onChange={e => setFrom(parseInt(e.target.value))}
          style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '0.5px solid #ccc', background: '#fff' }}
        >
          {data.map((d, i) => <option key={i} value={i}>{shortLabel(d.monday)}</option>)}
        </select>
        <span style={{ fontSize: '12px', color: '#888' }}>até</span>
        <select
          value={to}
          onChange={e => setTo(parseInt(e.target.value))}
          style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '0.5px solid #ccc', background: '#fff' }}
        >
          {data.map((d, i) => <option key={i} value={i}>{shortLabel(d.monday)}</option>)}
        </select>
        <button
          onClick={() => setApplied({ from, to })}
          style={{ fontSize: '12px', padding: '4px 16px', borderRadius: '6px', border: '0.5px solid #ccc', background: '#fff', cursor: 'pointer', marginLeft: 'auto' }}
        >
          Atualizar
        </button>
      </div>

      {slice.map((d, idx) => (
        <WeekBlock
          key={d.monday}
          data={d}
          prev={idx > 0 ? slice[idx - 1] : null}
          metrics={METRICS}
        />
      ))}

      <StatsChart slice={slice} metrics={METRICS} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '12px', fontSize: '12px', color: '#666' }}>
        {METRICS.map(m => (
          <span key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="24" height="10">
              <line x1="0" y1="5" x2="24" y2="5" stroke={m.color}
                strokeWidth={m.key === 'ativos' ? 2.5 : m.key === 'total' ? 1.5 : 2}
                strokeDasharray={
                  m.key === 'total' ? '2,4' :
                  m.key === 'newsletters' ? '8,4' :
                  m.key === 'ativos' ? undefined : '5,4'
                } />
              <circle cx="12" cy="5" r="3" fill={m.color} />
            </svg>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  )
}
