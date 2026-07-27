// post-link.js
// Busca o post mais antigo sem a tag #whatsapp-posted e envia ao canal do WhatsApp.
// Depois de enviar, adiciona a tag ao post no Ghost para não repostar.

const crypto = require("crypto");

const GHOST_URL = process.env.GHOST_URL || "https://oitoronto.ghost.io";
const GHOST_ADMIN_API_KEY = process.env.GHOST_ADMIN_API_KEY;
const WAHA_URL = process.env.WAHA_URL;
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const SESSION = process.env.WAHA_SESSION || "default";
const CHANNEL_ID = process.env.WAHA_CHANNEL_ID;
const POSTS_SINCE = process.env.POSTS_SINCE; // ex: "2026-07-02" — ignora posts anteriores a essa data
const TEST_MODE = process.argv.includes("--test"); // pega o último post e não marca a tag
// Pré-aquecimento do cache de imagem: envia o preview para este chat antes do
// canal, para o WhatsApp buscar/cachear a imagem (senão o 1º envio ao canal sai
// com thumbnail pequeno). DEVE ser um chat DESCARTÁVEL (ex: um grupo só do bot,
// "...@g.us") — o chat é LIMPO após cada post, então não use conversas reais.
const WARM_CHAT = process.env.WAHA_WARM_CHAT;
const WARM_DELAY_MS = Number(process.env.WAHA_WARM_DELAY_MS || 20000);

function generateJWT(adminApiKey) {
  const [id, secret] = adminApiKey.split(":");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT", kid: id };
  const payload = { iat: now, exp: now + 300, aud: "/admin/" };
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const toSign = `${encode(header)}.${encode(payload)}`;
  const sig = crypto
    .createHmac("sha256", Buffer.from(secret, "hex"))
    .update(toSign)
    .digest("base64url");
  return `${toSign}.${sig}`;
}

async function fetchNextPost(jwt) {
  // Modo teste: pega o post mais recente, sem filtrar tag nem POSTS_SINCE.
  // Produção: pega o mais antigo ainda sem a tag, desde POSTS_SINCE.
  const filters = TEST_MODE
    ? ["status:published"]
    : [
        "status:published",
        "tag:-hash-whatsapp-posted",
        ...(POSTS_SINCE ? [`published_at:>='${POSTS_SINCE}'`] : []),
      ];
  const order = TEST_MODE ? "desc" : "asc";
  const url =
    `${GHOST_URL}/ghost/api/admin/posts/` +
    `?limit=1&order=published_at%20${order}` +
    `&filter=${encodeURIComponent(filters.join("+"))}` +
    `&include=tags`;
  const res = await fetch(url, { headers: { Authorization: `Ghost ${jwt}` } });
  if (!res.ok) throw new Error(`Ghost API retornou ${res.status}: ${await res.text()}`);
  const { posts } = await res.json();
  return posts[0] || null;
}

// Monta a legenda da mensagem: título em negrito + descrição + link.
// Puxa tudo do Ghost — não depende do preview automático do WhatsApp.
function buildCaption(post) {
  const description = buildDescription(post);
  const parts = [`*${post.title}*`];
  if (description) parts.push(description);
  parts.push(post.url);
  return parts.join("\n\n");
}

function buildDescription(post) {
  return post.og_description || post.custom_excerpt || post.excerpt || "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wahaPost(endpoint, body) {
  const headers = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) headers["X-Api-Key"] = WAHA_API_KEY;
  const res = await fetch(`${WAHA_URL}/api/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`WAHA retornou ${res.status}: ${await res.text()}`);
  return res.json().catch(() => ({}));
}

// Preview de link com a feature image do Ghost que nós fornecemos, para um chatId.
function previewBody(chatId, post) {
  return {
    session: SESSION,
    chatId,
    text: post.url,
    linkPreviewHighQuality: true,
    preview: {
      url: post.url,
      title: post.title,
      description: buildDescription(post) || post.title,
      image: { url: post.feature_image },
    },
  };
}

// Apaga uma mensagem (revoke). No GOWS é o único método disponível (clear-chat
// não é implementado). Deixa um tombstone, mas no grupo descartável isso é ok.
async function wahaDelete(chatId, messageId) {
  const headers = {};
  if (WAHA_API_KEY) headers["X-Api-Key"] = WAHA_API_KEY;
  const path =
    `${SESSION}/chats/${encodeURIComponent(chatId)}` +
    `/messages/${encodeURIComponent(messageId)}`;
  const res = await fetch(`${WAHA_URL}/api/${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`WAHA delete retornou ${res.status}: ${await res.text()}`);
}

async function sendToChannel(post) {
  // Sem imagem: texto simples.
  if (!post.feature_image) {
    await wahaPost("sendText", { session: SESSION, chatId: CHANNEL_ID, text: buildCaption(post) });
    return;
  }

  // Pré-aquece o cache: manda o preview para WARM_CHAT e espera, para o WhatsApp
  // cachear a imagem antes do envio ao canal (senão o 1º envio sai pequeno).
  let warmMsgId;
  if (WARM_CHAT) {
    const warm = await wahaPost("send/link-custom-preview", previewBody(WARM_CHAT, post));
    warmMsgId = warm && warm.id;
    await sleep(WARM_DELAY_MS);
  }

  await wahaPost("send/link-custom-preview", previewBody(CHANNEL_ID, post));

  // Canal já recebeu (imagem cacheada) — apaga a mensagem de aquecimento.
  // Falha aqui não é crítica: a postagem no canal já foi feita.
  if (WARM_CHAT && warmMsgId) {
    try {
      await wahaDelete(WARM_CHAT, warmMsgId);
    } catch (e) {
      console.error("Aviso: não consegui apagar a mensagem de aquecimento:", e.message);
    }
  }
}

async function markAsPosted(jwt, post) {
  const tags = [...post.tags.map((t) => ({ id: t.id })), { name: "#whatsapp-posted" }];
  const res = await fetch(`${GHOST_URL}/ghost/api/admin/posts/${post.id}/`, {
    method: "PUT",
    headers: {
      Authorization: `Ghost ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ posts: [{ tags, updated_at: post.updated_at }] }),
  });
  if (!res.ok) throw new Error(`Falha ao marcar post no Ghost (${res.status}): ${await res.text()}`);
}

async function main() {
  if (!GHOST_ADMIN_API_KEY || !WAHA_URL || !CHANNEL_ID) {
    throw new Error("Faltam variáveis: GHOST_ADMIN_API_KEY, WAHA_URL e/ou WAHA_CHANNEL_ID");
  }

  const jwt = generateJWT(GHOST_ADMIN_API_KEY);
  const post = await fetchNextPost(jwt);

  if (!post) {
    console.log("Nenhum post novo para postar.");
    return;
  }

  await sendToChannel(post);

  if (TEST_MODE) {
    console.log(`[TESTE] Enviado (sem marcar tag): ${post.title} — ${post.url}`);
    return;
  }

  console.log(`Postado: ${post.title} — ${post.url}`);
  await markAsPosted(jwt, post);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { generateJWT, sendToChannel, previewBody, wahaPost };
