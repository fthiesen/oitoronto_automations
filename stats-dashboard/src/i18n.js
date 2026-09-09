// Idioma via query string: ?language=en  (ou &language=en, se ja houver outro parametro).
// Fixo no carregamento da pagina -- nao ha troca de idioma em tempo de execucao,
// entao os textos podem ser resolvidos uma unica vez na importacao dos modulos.
const match = /[?&/]language=([a-z-]{2,5})/i.exec(window.location.href)
export const lang = match && match[1].toLowerCase().startsWith('en') ? 'en' : 'pt'
export const locale = lang === 'en' ? 'en-CA' : 'pt-BR'

const STRINGS = {
	pt: {
		subtitle: 'Atualizado diariamente à meia-noite',
		loading: 'Carregando...',
		loadError: 'Não foi possível carregar os dados.',
		tagsError: 'Não foi possível carregar os dados de cadastros por tag.',
		to: 'até',
		postsSince: 'Posts publicados desde 2009',
		chartAria: 'Gráfico de linha com a evolução diária',
		pickStart: 'Escolha a data inicial',
		pickEnd: 'Escolha a data final',
		metricTotal: 'Total de membros',
		metricActive: 'Membros ativos',
		metricNewsletters: 'Membros em Newsletters',
		metricIntegra: 'Membros - Leitura na Íntegra',
		metricNovidades: 'Membros - Novidades do Blog',
		tagsTitle: 'Cadastros por tag',
		tagsTotal: 'Total no período',
		membersPerPost: 'membros por post',
		signups: 'cadastros',
		posts: 'posts',
		months: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
		monthsShort: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
		weekdays: ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'],
	},
	en: {
		subtitle: 'Updated daily at midnight',
		loading: 'Loading...',
		loadError: 'Could not load the data.',
		tagsError: 'Could not load the signups-by-tag data.',
		to: 'to',
		postsSince: 'Posts published since 2009',
		chartAria: 'Line chart of daily growth',
		pickStart: 'Pick the start date',
		pickEnd: 'Pick the end date',
		metricTotal: 'Total members',
		metricActive: 'Active members',
		metricNewsletters: 'Newsletter subscribers',
		// Nomes proprios das newsletters: nao se traduzem.
		metricIntegra: 'Subscribers - Leitura na Íntegra',
		metricNovidades: 'Subscribers - Novidades do Blog',
		tagsTitle: 'Signups by tag',
		tagsTotal: 'Total in period',
		membersPerPost: 'members per post',
		signups: 'signups',
		posts: 'posts',
		months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
		monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
		weekdays: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
	},
}

export const t = STRINGS[lang]

// As tags vem do Ghost em portugues; traduzidas so para exibicao.
const TAG_NAMES_EN = {
	'Imigração': 'Immigration',
	'Trabalho': 'Work',
	'Moradia': 'Housing',
	'Dinheiro': 'Money',
	'Educação': 'Education',
	'Saúde': 'Health',
	'Manchetes': 'Headlines',
	'Turismo': 'Tourism',
	'Lazer': 'Leisure',
	'Papelada': 'Paperwork',
	'Transporte': 'Transport',
	'Experiência': 'Experience',
	'Paladar': 'Food',
	'Cinema': 'Cinema',
	'Esporte': 'Sports',
	'Música': 'Music',
	'Notícia': 'News',
	'Depoimento': 'Testimonial',
}

export function tagName(tag) {
	return lang === 'en' ? TAG_NAMES_EN[tag] || tag : tag
}

export function num(n) {
	return n.toLocaleString(locale)
}

// '2026-06-16' -> '16 jun' / 'Jun 16'
export function dayLabel(dateStr) {
	const [, m, d] = dateStr.split('-')
	const day = parseInt(d)
	const month = t.monthsShort[parseInt(m) - 1]
	return lang === 'en' ? `${month} ${day}` : `${day} ${month}`
}

// '2026-06' -> 'jun 2026' / 'Jun 2026'
export function monthLabel(ym) {
	const [y, m] = ym.split('-')
	return `${t.monthsShort[parseInt(m) - 1]} ${y}`
}
