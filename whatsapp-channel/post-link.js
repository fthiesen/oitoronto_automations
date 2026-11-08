// post-link.js
// Busca todos os posts sem a tag #whatsapp-posted e envia cada um ao canal do
// WhatsApp como preview de link (imagem + título + descrição, tudo do Ghost), do
// mais antigo para o mais novo. Depois de cada envio, adiciona a tag ao post no
// Ghost para não repostar.

const crypto = require("crypto");

const GHOST_URL = process.env.GHOST_URL || "https://oitoronto.ghost.io";
const GHOST_ADMIN_API_KEY = process.env.GHOST_ADMIN_API_KEY;
const WAHA_URL = process.env.WAHA_URL;
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const SESSION = process.env.WAHA_SESSION || "default";
const CHANNEL_ID = process.env.WAHA_CHANNEL_ID;
const POSTS_SINCE = process.env.POSTS_SINCE; // ex: "2026-07-02" — ignora posts anteriores a essa data
const TEST_MODE = process.argv.includes("--test"); // pega o último post e não marca a tag

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

async function fetchPendingPosts(jwt) {
  // Modo teste: só o post mais recente, sem filtrar tag nem POSTS_SINCE.
  // Produção: todos os posts ainda sem a tag, desde POSTS_SINCE, do mais antigo
  // para o mais novo (ordem cronológica no canal).
  const filters = TEST_MODE
    ? ["status:published"]
    : [
        "status:published",
        "tag:-hash-whatsapp-posted",
        ...(POSTS_SINCE ? [`published_at:>='${POSTS_SINCE}'`] : []),
      ];
  const url =
    `${GHOST_URL}/ghost/api/admin/posts/` +
    `?limit=${TEST_MODE ? 1 : "all"}&order=published_at%20${TEST_MODE ? "desc" : "asc"}` +
    `&filter=${encodeURIComponent(filters.join("+"))}` +
    `&include=tags`;
  const res = await fetch(url, { headers: { Authorization: `Ghost ${jwt}` } });
  if (!res.ok) throw new Error(`Ghost API retornou ${res.status}: ${await res.text()}`);
  const { posts } = await res.json();
  return posts;
}

function buildDescription(post) {
  return post.og_description || post.custom_excerpt || post.excerpt || "";
}

// Fallback (post sem imagem): título em negrito + descrição + link no texto.
function buildCaption(post) {
  const description = buildDescription(post);
  const parts = [`*${post.title}*`];
  if (description) parts.push(description);
  parts.push(post.url);
  return parts.join("\n\n");
}

// Reduz a imagem do Ghost para JPEG ~1200px. O WhatsApp só renderiza JPEG de forma
// confiável no preview do canal — imagens webp ou PNG falham (imagem some). O
// transform do Ghost converte na origem. URLs que não são do Ghost ficam iguais.
function toWhatsAppImage(url) {
  if (url && url.includes("/content/images/") && !url.includes("/content/images/size/")) {
    return url.replace("/content/images/", "/content/images/size/w1200/format/jpeg/");
  }
  return url;
}

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

async function sendToChannel(post) {
  // Sem imagem: texto simples.
  if (!post.feature_image) {
    await wahaPost("sendText", { session: SESSION, chatId: CHANNEL_ID, text: buildCaption(post) });
    return;
  }
  // Com imagem: preview de link, com a imagem convertida para JPEG.
  await wahaPost("send/link-custom-preview", previewBody(CHANNEL_ID, post));
}

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
      image: { url: toWhatsAppImage(post.feature_image) },
    },
  };
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

  const posts = await fetchPendingPosts(generateJWT(GHOST_ADMIN_API_KEY));

  if (posts.length === 0) {
    console.log("Nenhum post novo para postar.");
    return;
  }

  for (const [i, post] of posts.entries()) {
    // Pequena pausa entre envios para não mandar uma rajada ao canal.
    if (i > 0) await new Promise((r) => setTimeout(r, 5000));

    await sendToChannel(post);

    if (TEST_MODE) {
      console.log(`[TESTE] Enviado (sem marcar tag): ${post.title} — ${post.url}`);
      continue;
    }

    console.log(`Postado: ${post.title} — ${post.url}`);
    // Marca logo após cada envio (JWT novo: o token expira em 5 min). Se algo
    // falhar no meio, os posts já enviados ficam marcados e o resto vai na próxima.
    await markAsPosted(generateJWT(GHOST_ADMIN_API_KEY), post);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { generateJWT, sendToChannel, wahaPost, toWhatsAppImage };
