import { shortLabel } from './App'

export default function ComparisonBlock({ firstDay, lastDay, metrics }) {
	const sameDay = firstDay.date === lastDay.date

	return (
		<div style={{ marginBottom: '1.5rem' }}>
			{/* DESKTOP / TABLET — cards lado a lado, fundo sólido, setinhas verticais entre os dois blocos */}
			<div className='comparison-desktop'>
				<p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px' }}>
					{shortLabel(firstDay.date)}
				</p>
				<div
					style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px' }}
				>
					{metrics.map(m => (
						<div
							key={m.key}
							style={{
								borderRadius: '8px',
								padding: '0.75rem',
								background: m.color,
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
								{m.label}
							</p>
							<p style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
								{firstDay[m.key].toLocaleString('pt-BR')}
							</p>
						</div>
					))}
				</div>

				{!sameDay && (
					<>
						<div
							style={{
								display: 'grid',
								gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
								gap: '8px',
								height: '36px',
								margin: '12px 0 4px',
							}}
						>
							{metrics.map(m => {
								const diff = lastDay[m.key] - firstDay[m.key]
								const circleColor = diff > 0 ? '#2bc700' : diff < 0 ? '#e02b20' : '#bbb'
								const circleArrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '–'
								const diffText = diff > 0 ? '+' + diff : diff < 0 ? String(diff) : '='
								return (
									<div
										key={m.key}
										style={{
											display: 'flex',
											justifyContent: 'center',
											alignItems: 'center',
											height: '100%',
											gap: '6px',
										}}
									>
										<span
											style={{
												width: '28px',
												height: '28px',
												borderRadius: '50%',
												background: circleColor,
												color: '#fff',
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												fontSize: '15px',
												fontWeight: 700,
												flexShrink: 0,
											}}
										>
											{circleArrow}
										</span>
										<span style={{ fontSize: '14px', fontWeight: 700, color: circleColor }}>
											{diffText}
										</span>
									</div>
								)
							})}
						</div>

						<p style={{ fontSize: '11px', color: '#999', margin: '0 0 8px' }}>
							{shortLabel(lastDay.date)}
						</p>
						<div
							style={{
								display: 'grid',
								gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
								gap: '8px',
							}}
						>
							{metrics.map(m => (
								<div
									key={m.key}
									style={{
										borderRadius: '8px',
										padding: '0.75rem',
										background: m.color,
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
										{m.label}
									</p>
									<p style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>
										{lastDay[m.key].toLocaleString('pt-BR')}
									</p>
								</div>
							))}
						</div>
					</>
				)}
			</div>

			{/* MOBILE — tabela com setinha entre os dois valores, fundo sólido por linha */}
			<div className='comparison-mobile'>
				<div
					style={{
						display: 'flex',
						justifyContent: 'flex-end',
						fontSize: '11px',
						color: '#999',
						marginBottom: '6px',
					}}
				>
					{sameDay
						? shortLabel(firstDay.date)
						: `${shortLabel(firstDay.date)} → ${shortLabel(lastDay.date)}`}
				</div>

				<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
					{metrics.map(m => {
						const startVal = firstDay[m.key]
						const endVal = lastDay[m.key]
						const diff = sameDay ? null : endVal - startVal

						let circleColor = '#bbb'
						let circleArrow = '–'
						let diffText = '='
						if (diff !== null) {
							if (diff > 0) {
								circleColor = '#2bc700'
								circleArrow = '↑'
								diffText = '+' + diff
							} else if (diff < 0) {
								circleColor = '#e02b20'
								circleArrow = '↓'
								diffText = String(diff)
							}
						}

						return (
							<div
								key={m.key}
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'space-between',
									gap: '8px',
									padding: '10px 12px',
									borderRadius: '8px',
									background: m.color,
									color: '#fff',
								}}
							>
								<span
									style={{
										fontSize: '12px',
										fontWeight: 500,
										opacity: 0.9,
										whiteSpace: 'nowrap',
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										flexShrink: 1,
										minWidth: 0,
									}}
								>
									{m.label}
								</span>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
									<span style={{ fontSize: '13px', fontWeight: 600 }}>
										{startVal.toLocaleString('pt-BR')}
									</span>
									{!sameDay && (
										<>
											<span style={{ fontSize: '12px', opacity: 0.7 }}>→</span>
											<span style={{ fontSize: '13px', fontWeight: 600 }}>
												{endVal.toLocaleString('pt-BR')}
											</span>
											<span
												style={{
													width: '22px',
													height: '22px',
													borderRadius: '50%',
													background: circleColor,
													color: '#fff',
													display: 'flex',
													alignItems: 'center',
													justifyContent: 'center',
													fontSize: '12px',
													fontWeight: 700,
													flexShrink: 0,
												}}
											>
												{circleArrow}
											</span>
											<span style={{ fontSize: '12px', fontWeight: 700, opacity: 0.95 }}>
												{diffText}
											</span>
										</>
									)}
								</div>
							</div>
						)
					})}
				</div>
			</div>

			<style>{`
        .comparison-mobile { display: none; }
        @media (max-width: 600px) {
          .comparison-desktop { display: none; }
          .comparison-mobile { display: block; }
        }
      `}</style>
		</div>
	)
}
