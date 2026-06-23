#!/usr/bin/env node

/**
 * newsletter-novidades-do-blog.js
 *
 * Gera e agenda automaticamente a newsletter "Novidades do Blog" no Ghost.
 *
 * O script:
 *   1. Conecta na Ghost Admin API via JWT
 *   2. Identifica a data do ultimo envio pela tag #ChamadasDoDia
 *   3. Busca posts publicados desde entao
 *   4. Monta o conteudo Lexical com resumo de cada materia + anuncio do patrocinador
 *      (suporta card call-to-action nativo e HTML com data-ad)
 *   5. Cria o post como draft e agenda como email-only na newsletter
 *
 * Dependencias: nenhuma externa (usa crypto e fetch nativos do Node 18+)
 *
 * Uso: node newsletter-novidades-do-blog.js
 */

const crypto = require('crypto')
const { GHOST_URL, NEWSLETTER_SLUG, getApiKey } = require('./config')

// ============================================================
// CONFIGURACAO — Edite estas constantes conforme necessario
// ============================================================

// Tag interna que identifica posts de newsletter (comeca com #)
const NEWSLETTER_TAG = '#ChamadasDoDia'

// Horario de agendamento do envio no formato HH:MM
const SCHEDULE_TIME = '07:10'

// Fuso horario de referencia para o agendamento
const TIMEZONE = 'America/Toronto'

// Numero de paragrafos iniciais da materia a incluir no resumo
const NUM_PARAGRAPHS = 1

// Prefixo do titulo da newsletter
const TITLE_PREFIX = 'Novidades do Blog'

// ============================================================
// 2. JWT — Autenticacao Ghost Admin API
// ============================================================

function base64url(buf) {
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generateToken(apiKey) {
	const [id, secret] = apiKey.split(':')
	if (!id || !secret) {
		throw new Error('API key invalida. Formato esperado: <id>:<secret>')
	}

	const now = Math.floor(Date.now() / 1000)
	const header = { alg: 'HS256', typ: 'JWT', kid: id }
	const payload = { iat: now, exp: now + 5 * 60, aud: '/admin/' }

	const h = base64url(Buffer.from(JSON.stringify(header)))
	const p = base64url(Buffer.from(JSON.stringify(payload)))
	const sig = crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${h}.${p}`).digest()

	return `${h}.${p}.${base64url(sig)}`
}

// ============================================================
// 3. Helpers HTTP
// ============================================================

async function ghostGet(endpoint, apiKey) {
	const token = generateToken(apiKey)
	const url = `${GHOST_URL}/ghost/api/admin/${endpoint}`
	const res = await fetch(url, {
		headers: { Authorization: `Ghost ${token}`, 'Accept-Version': 'v5.0' },
	})
	if (!res.ok) {
		const body = await res.text()
		throw new Error(`GET ${endpoint} falhou (${res.status}): ${body}`)
	}
	return res.json()
}

async function ghostPost(endpoint, body, apiKey) {
	const token = generateToken(apiKey)
	const url = `${GHOST_URL}/ghost/api/admin/${endpoint}`
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Ghost ${token}`,
			'Accept-Version': 'v5.0',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		const responseBody = await res.text()
		throw new Error(`POST ${endpoint} falhou (${res.status}): ${responseBody}`)
	}
	return res.json()
}

async function ghostPut(endpoint, body, apiKey) {
	const token = generateToken(apiKey)
	const url = `${GHOST_URL}/ghost/api/admin/${endpoint}`
	const res = await fetch(url, {
		method: 'PUT',
		headers: {
			Authorization: `Ghost ${token}`,
			'Accept-Version': 'v5.0',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	})
	if (!res.ok) {
		const responseBody = await res.text()
		throw new Error(`PUT ${endpoint} falhou (${res.status}): ${responseBody}`)
	}
	return res.json()
}

// ============================================================
// 4. Processamento de conteudo Lexical
// ============================================================

/**
 * Extrai o texto de um no Lexical do tipo paragraph.
 * Retorna a concatenacao de todos os filhos de texto.
 */
function extractParagraphText(node) {
	if (!node.children) return ''
	return node.children
		.filter(c => c.type === 'extended-text' || c.type === 'text')
		.map(c => c.text || '')
		.join('')
}

/**
 * Extrai os primeiros N paragrafos de um Lexical root e junta em um texto so.
 */
function extractFirstParagraphs(lexicalRoot, count) {
	const children = lexicalRoot?.root?.children || []
	const paragraphs = []

	for (const child of children) {
		if (child.type === 'paragraph') {
			const text = extractParagraphText(child)
			if (text.trim()) {
				paragraphs.push(text.trim())
				if (paragraphs.length >= count) break
			}
		}
	}

	return paragraphs.join(' ')
}

/**
 * Encontra o card de anuncio do patrocinador no Lexical.
 *
 * Suporta dois formatos:
 *   1. Card nativo "call-to-action" do Ghost (tipo antigo)
 *   2. Card "html" contendo <div data-ad>...</div> (tipo novo, banner de imagem)
 *
 * Retorna o bloco JSON inteiro do no Lexical, ou null se nao encontrar.
 */
function findAdCard(lexicalRoot) {
	const children = lexicalRoot?.root?.children || []
	// Anuncios aparecem apenas nos primeiros blocos do post (ate o 4o no).
	// Apos isso, qualquer CTA encontrado e mensagem interna do blog, nao anuncio.
	const limit = Math.min(children.length, 4)
	for (let i = 0; i < limit; i++) {
		const child = children[i]
		// Formato 1: card nativo call-to-action
		if (child.type === 'call-to-action') {
			return child
		}
		// Formato 2: bloco HTML com marcador data-ad
		if (child.type === 'html' && typeof child.html === 'string' && child.html.includes('data-ad')) {
			return child
		}
	}
	return null
}

// ============================================================
// 5. Montagem do Lexical da newsletter
// ============================================================

function makeImageNode(src, alt = '') {
	return {
		type: 'image',
		version: 1,
		src: src,
		width: 0,
		height: 0,
		title: '',
		alt: alt,
		caption: '',
		cardWidth: 'regular',
		href: '',
	}
}

function makeHeadingNode(text) {
	return {
		children: [
			{
				detail: 0,
				format: 0,
				mode: 'normal',
				style: '',
				text: text,
				type: 'extended-text',
				version: 1,
			},
		],
		direction: null,
		format: '',
		indent: 0,
		type: 'extended-heading',
		version: 1,
		tag: 'h3',
	}
}

function makeParagraphNode(text) {
	return {
		children: [
			{
				detail: 0,
				format: 0,
				mode: 'normal',
				style: '',
				text: text,
				type: 'extended-text',
				version: 1,
			},
		],
		direction: null,
		format: '',
		indent: 0,
		type: 'paragraph',
		version: 1,
	}
}

function makeButtonNode(text, url) {
	return {
		type: 'button',
		version: 1,
		buttonText: text,
		alignment: 'center',
		buttonUrl: url,
	}
}

function makeDividerNode() {
	return { type: 'horizontalrule', version: 1 }
}

/**
 * Monta o JSON Lexical completo da newsletter a partir dos dados das materias.
 *
 * @param {Array} articles — Array de objetos com:
 *   { title, featuredImage, summary, url, adCard (call-to-action ou html com data-ad) }
 * @returns {string} JSON Lexical serializado
 */
function buildNewsletterLexical(articles) {
	const children = []

	articles.forEach((article, index) => {
		// Featured image
		if (article.featuredImage) {
			children.push(makeImageNode(article.featuredImage, article.title))
		}

		// Titulo como H3
		children.push(makeHeadingNode(article.title))

		// Paragrafo resumo
		if (article.summary) {
			children.push(makeParagraphNode(article.summary))
		}

		// Botao "Leia Mais"
		children.push(makeButtonNode('Leia na Íntegra', article.url))

		// Card CTA do anunciante
		if (article.adCard) {
			if (article.adCard.type === 'html') {
				// Anuncio HTML (data-ad): wrapper com margem para igualar
				// o espacamento do card call-to-action nativo
				const styled = { ...article.adCard }
				styled.html =
					'<div style="margin-top:0;margin-bottom:1.5em">' + styled.html.trim() + '</div>'
				children.push(styled)
			} else {
				children.push(article.adCard)
			}
		}

		// Divider entre materias (exceto apos a ultima)
		// if (index < articles.length - 1) {
		// 	children.push(makeDividerNode())
		// }
	})

	return JSON.stringify({
		root: {
			children: children,
			direction: null,
			format: '',
			indent: 0,
			type: 'root',
			version: 1,
		},
	})
}

// ============================================================
// 6. Calculo do horario de agendamento
// ============================================================

function getScheduledDate() {
	const [schedHour, schedMin] = SCHEDULE_TIME.split(':').map(Number)
	const now = new Date()

	// Data de hoje no fuso configurado
	const localDateStr = new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(now)

	// Descobre o offset UTC atual do fuso (ex: EDT = -04:00, EST = -05:00)
	const tzParts = new Intl.DateTimeFormat('en-US', {
		timeZone: TIMEZONE,
		timeZoneName: 'short',
	}).formatToParts(now)
	const tzName = tzParts.find(p => p.type === 'timeZoneName')?.value || ''
	const offset = tzName === 'EDT' ? '-04:00' : '-05:00'

	const [year, month, day] = localDateStr.split('-')
	const pad = n => String(n).padStart(2, '0')

	let isoStr = `${year}-${month}-${day}T${pad(schedHour)}:${pad(schedMin)}:00${offset}`
	let scheduledDate = new Date(isoStr)

	// Se o horario ja passou, agenda para amanha
	if (scheduledDate <= now) {
		const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
		const tmDateStr = new Intl.DateTimeFormat('en-CA', {
			timeZone: TIMEZONE,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format(tomorrow)
		const [y2, m2, d2] = tmDateStr.split('-')
		isoStr = `${y2}-${m2}-${d2}T${pad(schedHour)}:${pad(schedMin)}:00${offset}`
		scheduledDate = new Date(isoStr)
	}

	return scheduledDate.toISOString()
}

// ============================================================
// 7. Formatacao do titulo
// ============================================================

function formatNewsletterTitle(scheduledDate) {
	const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
	const date = new Date(scheduledDate)

	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(date)

	const [year, month, day] = parts.split('-')
	const mesAbrev = meses[parseInt(month, 10) - 1]

	return `${TITLE_PREFIX}: ${parseInt(day, 10)}/${mesAbrev}/${year}`
}

// ============================================================
// 8. Funcao Principal
// ============================================================

async function main() {
	console.log('\n=== Newsletter Novidades do Blog ===\n')

	// --- 1. Obter API key ---
	console.log('[1/6] Obtendo API key...')
	const apiKey = getApiKey()
	console.log('  API key obtida com sucesso\n')

	// --- 2. Encontrar data do ultimo envio ---
	console.log('[2/6] Buscando ultimo envio da newsletter...')

	// O slug interno da tag # eh "hash-" + nome em lowercase sem acentos
	const tagSlug = 'hash-chamadasdodia'
	let sinceDate

	// Permite override via --since=YYYY-MM-DD para testes
	const sinceArg = process.argv.find(a => a.startsWith('--since='))
	if (sinceArg) {
		sinceDate = new Date(sinceArg.split('=')[1]).toISOString()
		console.log(`  Override via --since: ${sinceDate}\n`)
	} else {
		try {
			const lastNewsletter = await ghostGet(
				`posts/?filter=tag:${tagSlug}&order=published_at%20desc&limit=1&formats=lexical`,
				apiKey
			)

			if (lastNewsletter.posts && lastNewsletter.posts.length > 0) {
				const lastPost = lastNewsletter.posts[0]
				sinceDate = lastPost.published_at || lastPost.created_at
				console.log(`  Ultimo envio: "${lastPost.title}"`)
				console.log(`  Data: ${sinceDate}\n`)
			} else {
				sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
				console.log(`  Nenhum envio anterior encontrado. Usando ultimas 24h: ${sinceDate}\n`)
			}
		} catch (err) {
			sinceDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
			console.log(`  Erro ao buscar ultimo envio (${err.message}). Usando ultimas 24h.\n`)
		}
	}

	// --- 3. Buscar posts publicados (ou agendados antes do envio) desde o ultimo envio ---
	console.log('[3/6] Buscando posts publicados desde o ultimo envio...')

	// Horario de envio da newsletter — posts agendados antes desse momento ja estarao
	// publicados quando a newsletter for enviada, entao devem ser incluidos.
	const publishedAt = getScheduledDate()

	const filterPublished = `status:published+published_at:>'${sinceDate}'+tag:-${tagSlug}`
	const filterScheduled = `status:scheduled+published_at:>'${sinceDate}'+published_at:<'${publishedAt}'+tag:-${tagSlug}`

	const [publishedResult, scheduledResult] = await Promise.all([
		ghostGet(
			`posts/?filter=${encodeURIComponent(
				filterPublished
			)}&order=published_at%20desc&limit=50&formats=lexical&include=tags`,
			apiKey
		),
		ghostGet(
			`posts/?filter=${encodeURIComponent(
				filterScheduled
			)}&order=published_at%20desc&limit=50&formats=lexical&include=tags`,
			apiKey
		),
	])

	const publishedPosts = [...(publishedResult.posts || []), ...(scheduledResult.posts || [])].sort(
		(a, b) => new Date(b.published_at) - new Date(a.published_at)
	)

	console.log(
		`  Encontrados: ${publishedResult.posts?.length || 0} publicado(s) + ${
			scheduledResult.posts?.length || 0
		} agendado(s) = ${publishedPosts.length} total\n`
	)

	if (publishedPosts.length === 0) {
		console.log('  Nao ha posts novos desde o ultimo envio. Nada a fazer.\n')
		process.exit(0)
	}

	// --- 4. Processar cada materia ---
	console.log('[4/6] Processando materias...\n')

	const articles = []

	for (const post of publishedPosts) {
		const lexical = post.lexical ? JSON.parse(post.lexical) : null

		const featuredImage = post.feature_image || null
		const title = post.title || '(sem titulo)'
		const summary = lexical ? extractFirstParagraphs(lexical, NUM_PARAGRAPHS) : ''
		const url = post.url || `${GHOST_URL}/${post.slug}/`
		const adCard = lexical ? findAdCard(lexical) : null

		articles.push({ title, featuredImage, summary, url, adCard })

		console.log(`  - ${title}`)
		console.log(`    Imagem: ${featuredImage ? 'sim' : 'nao'}`)
		console.log(`    Resumo: ${summary.substring(0, 80)}...`)
		console.log(`    Anuncio: ${adCard ? 'sim' : 'nao encontrado'}`)
		console.log(`    URL: ${url}\n`)
	}

	// --- 5. Criar post draft com conteudo Lexical ---
	console.log('[5/6] Criando post draft da newsletter...')

	const newsletterTitle = formatNewsletterTitle(publishedAt)
	const lexicalContent = buildNewsletterLexical(articles)

	const createResult = await ghostPost(
		'posts/',
		{
			posts: [
				{
					title: newsletterTitle,
					lexical: lexicalContent,
					tags: [{ name: NEWSLETTER_TAG }],
					visibility: 'members',
					status: 'draft',
				},
			],
		},
		apiKey
	)

	const draftPost = createResult.posts[0]
	console.log(`  Titulo: ${draftPost.title}`)
	console.log(`  ID: ${draftPost.id}`)
	console.log(`  Status: ${draftPost.status}\n`)

	// --- 6. Agendar como email-only via newsletter ---
	console.log('[6/6] Agendando envio via newsletter...')

	const scheduleResult = await ghostPut(
		`posts/${draftPost.id}/?newsletter=${NEWSLETTER_SLUG}`,
		{
			posts: [
				{
					status: 'scheduled',
					published_at: publishedAt,
					email_only: true,
					updated_at: draftPost.updated_at,
				},
			],
		},
		apiKey
	)

	const scheduledPost = scheduleResult.posts[0]

	// --- Resumo final ---
	console.log('\n========================================')
	console.log('  RESUMO DO AGENDAMENTO')
	console.log('========================================\n')
	console.log(`  Titulo:       ${scheduledPost.title}`)
	console.log(`  Materias:     ${articles.length}`)
	console.log(`  Horario:      ${scheduledPost.published_at} (${SCHEDULE_TIME} ${TIMEZONE})`)
	console.log(`  Newsletter:   ${scheduledPost.newsletter?.name || NEWSLETTER_SLUG}`)
	console.log(`  Email only:   ${scheduledPost.email_only}`)
	console.log(`  Status:       ${scheduledPost.status}`)
	console.log(`  Visibility:   ${scheduledPost.visibility}`)
	console.log(`  Tags:         ${scheduledPost.tags.map(t => t.name).join(', ')}`)
	console.log(`  Post ID:      ${scheduledPost.id}`)
	console.log('\n  Agendamento concluido com sucesso!\n')
}

main().catch(err => {
	console.error(`\nErro: ${err.message}\n`)
	if (err.stack) console.error(err.stack)
	process.exit(1)
})

