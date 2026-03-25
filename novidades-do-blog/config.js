/**
 * config.js
 *
 * Configuracoes compartilhadas entre os scripts Ghost.
 * As credenciais sao lidas do arquivo .env na raiz do projeto.
 */

require('dotenv').config()

// ============================================================
// Configuracoes da instancia Ghost — edite conforme necessario
// ============================================================

// URL da instancia Ghost (sem barra final)
const GHOST_URL = 'https://oitoronto.ghost.io'

// Slug da newsletter principal
const NEWSLETTER_SLUG = 'chamadas-do-dia'

// ============================================================
// Leitura da API Key — nao edite abaixo desta linha
// ============================================================

function getApiKey() {
	const key = process.env.GHOST_ADMIN_API_KEY
	if (!key) {
		throw new Error(
			'GHOST_ADMIN_API_KEY nao definida.\n' +
				'Adicione a variavel ao arquivo .env ou ao ambiente do servidor.'
		)
	}
	return key
}

module.exports = { GHOST_URL, NEWSLETTER_SLUG, getApiKey }
