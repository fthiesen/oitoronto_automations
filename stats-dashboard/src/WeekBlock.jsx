import { shortLabel } from './App'

export default function WeekBlock({ data, prev, metrics }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <p style={{ fontSize: '11px', color: '#999', marginBottom: '8px' }}>{shortLabel(data.date)}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px' }}>
        {metrics.map(m => {
          const val = data[m.key]
          const prevVal = prev ? prev[m.key] : null
          const diff = prevVal !== null ? val - prevVal : null

          let badgeBg = '#eee'
          let badgeColor = '#999'
          let badgeText = '—'

          if (diff !== null) {
            if (diff > 0) { badgeBg = '#2bc700'; badgeColor = '#0e4200'; badgeText = '+' + diff }
            else if (diff < 0) { badgeBg = '#e02b20'; badgeColor = '#fff'; badgeText = String(diff) }
            else { badgeText = '=' }
          }

          return (
            <div key={m.key} style={{
              borderRadius: '8px',
              padding: '0.75rem',
              border: '0.5px solid #e5e5e5',
              background: '#fff',
              borderTop: '3px solid ' + m.color,
            }}>
              <p style={{ fontSize: '11px', color: m.textColor, margin: '0 0 3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {m.label}
              </p>
              <p style={{ fontSize: '18px', fontWeight: 500, color: m.textColor, margin: '0 0 6px' }}>
                {val.toLocaleString('pt-BR')}
              </p>
              <span style={{
                display: 'inline-block',
                fontSize: '11px',
                fontWeight: 500,
                padding: '2px 7px',
                borderRadius: '4px',
                background: badgeBg,
                color: badgeColor,
              }}>
                {badgeText}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
