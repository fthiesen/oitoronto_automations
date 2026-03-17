#!/usr/bin/env node

/**
 * schedule-newsletter.js
 *
 * Agenda um post do Ghost como newsletter "Chamadas do Dia".
 *
 * Uso: node schedule-newsletter.js <post-id>
 *
 * O script:
 *   1. Le a GHOST_ADMIN_API_KEY de claude_desktop_config.json (ou env var)
 *   2. Busca o post pelo ID
 *   3. Adiciona a tag #ChamadasDoDia e define visibility = members
 *   4. Agenda o envio via newsletter "chamadas-do-dia" para hoje as 07:10 ET
 *
 * Dependencias: nenhuma externa (usa crypto e fetch nativos do Node 18+)
 * Para usar com jsonwebtoken: npm install jsonwebtoken e descomentar a secao alternativa
 */

const crypto = require('crypto');
const { GHOST_URL, NEWSLETTER_SLUG, getApiKey } = require('./config');

// --- Configuracao ---
const TAG_NAME = '#ChamadasDoDia';
const SCHEDULE_HOUR = 7;
const SCHEDULE_MINUTE = 10;

// ============================================================
// 2. JWT - Autenticacao Ghost Admin API
// ============================================================

function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateToken(apiKey) {
  const [id, secret] = apiKey.split(':');
  if (!id || !secret) {
    throw new Error('API key invalida. Formato esperado: <id>:<secret>');
  }

  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: id,
  };

  const payload = {
    iat: now,
    exp: now + 5 * 60, // 5 minutos
    aud: '/admin/',
  };

  const encodedHeader = base64url(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64url(signature)}`;
}

// ============================================================
// 3. Helpers HTTP
// ============================================================

async function ghostGet(endpoint, apiKey) {
  const token = generateToken(apiKey);
  const url = `${GHOST_URL}/ghost/api/admin/${endpoint}`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Ghost ${token}`,
      'Accept-Version': 'v5.0',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET ${endpoint} falhou (${res.status}): ${body}`);
  }
  return res.json();
}

async function ghostPut(endpoint, body, apiKey) {
  const token = generateToken(apiKey);
  const url = `${GHOST_URL}/ghost/api/admin/${endpoint}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Ghost ${token}`,
      'Accept-Version': 'v5.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const responseBody = await res.text();
    throw new Error(`PUT ${endpoint} falhou (${res.status}): ${responseBody}`);
  }
  return res.json();
}

// ============================================================
// 4. Calculo do horario 07:10 ET
// ============================================================

function getScheduledDate() {
  const now = new Date();

  // Descobre a data de hoje no fuso America/New_York
  const etDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  // Descobre se estamos em EDT (-04:00) ou EST (-05:00)
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  }).formatToParts(now);
  const tzName = tzParts.find(p => p.type === 'timeZoneName')?.value;
  const offset = tzName === 'EDT' ? '-04:00' : '-05:00';

  const [year, month, day] = etDateStr.split('-');
  const pad = (n) => String(n).padStart(2, '0');
  let scheduledISO = `${year}-${month}-${day}T${pad(SCHEDULE_HOUR)}:${pad(SCHEDULE_MINUTE)}:00${offset}`;
  let scheduledDate = new Date(scheduledISO);

  // Se o horario ja passou, agenda para amanha
  if (scheduledDate <= now) {
    const tomorrow = new Date(scheduledDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(tomorrow);
    const [y2, m2, d2] = tomorrowStr.split('-');
    scheduledISO = `${y2}-${m2}-${d2}T${pad(SCHEDULE_HOUR)}:${pad(SCHEDULE_MINUTE)}:00${offset}`;
    scheduledDate = new Date(scheduledISO);
  }

  return scheduledDate.toISOString();
}

// ============================================================
// 5. Funcao Principal
// ============================================================

async function main() {
  const postId = process.argv[2];

  if (!postId) {
    console.error('Uso: node schedule-newsletter.js <post-id>');
    console.error('');
    console.error('Exemplo:');
    console.error('  node schedule-newsletter.js 69b87eeb8d92730001ef164e');
    process.exit(1);
  }

  console.log(`\n=== Agendando Newsletter Chamadas do Dia ===\n`);
  console.log(`Post ID: ${postId}`);

  // --- Obter API key ---
  const apiKey = getApiKey();
  console.log('  API key obtida com sucesso\n');

  // --- Buscar post atual ---
  console.log('[1/3] Buscando dados do post...');
  const postData = await ghostGet(`posts/${postId}/?formats=lexical`, apiKey);
  const post = postData.posts[0];
  console.log(`  Titulo: ${post.title}`);
  console.log(`  Status atual: ${post.status}`);
  console.log(`  Tags atuais: ${(post.tags || []).map(t => t.name).join(', ') || '(nenhuma)'}`);
  console.log(`  Visibility atual: ${post.visibility}\n`);

  // --- Passo 1: Adicionar tag e definir visibility ---
  console.log('[2/3] Atualizando tag #ChamadasDoDia e visibility members...');

  const existingTags = (post.tags || []).map(t => {
    // Preservar tags existentes pelo slug (mais seguro que pelo nome)
    if (t.id) return { id: t.id };
    return { name: t.name };
  });
  const hasTag = (post.tags || []).some(t => t.name === TAG_NAME);
  const tags = hasTag
    ? existingTags
    : [...existingTags, { name: TAG_NAME }];

  const editResult = await ghostPut(`posts/${postId}/`, {
    posts: [{
      tags: tags,
      visibility: 'members',
      updated_at: post.updated_at,
    }],
  }, apiKey);

  const updatedPost = editResult.posts[0];
  console.log(`  Tags agora: ${updatedPost.tags.map(t => t.name).join(', ')}`);
  console.log(`  Visibility agora: ${updatedPost.visibility}\n`);

  // --- Passo 2: Agendar com newsletter ---
  const publishedAt = getScheduledDate();
  console.log('[3/3] Agendando envio via newsletter...');
  console.log(`  Newsletter: ${NEWSLETTER_SLUG}`);
  console.log(`  Horario: ${publishedAt} (07:10 ET)`);
  console.log(`  Email only: true`);

  const scheduleResult = await ghostPut(
    `posts/${postId}/?newsletter=${NEWSLETTER_SLUG}`,
    {
      posts: [{
        status: 'scheduled',
        published_at: publishedAt,
        email_only: true,
        updated_at: updatedPost.updated_at,
      }],
    },
    apiKey
  );

  const scheduledPost = scheduleResult.posts[0];

  console.log('\n=== Resultado ===\n');
  console.log(`  Titulo:      ${scheduledPost.title}`);
  console.log(`  Status:      ${scheduledPost.status}`);
  console.log(`  Publicacao:  ${scheduledPost.published_at}`);
  console.log(`  Email only:  ${scheduledPost.email_only}`);
  console.log(`  Newsletter:  ${scheduledPost.newsletter?.name || NEWSLETTER_SLUG}`);
  console.log(`  Visibility:  ${scheduledPost.visibility}`);
  console.log(`  Tags:        ${scheduledPost.tags.map(t => t.name).join(', ')}`);
  console.log('\n  Agendamento concluido com sucesso!\n');
}

main().catch(err => {
  console.error(`\nErro: ${err.message}\n`);
  process.exit(1);
});
