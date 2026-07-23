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

// Troca a extensão .webp por .jpg (o Ghost serve o mesmo arquivo em JPEG).
// URLs que já não são .webp ficam inalteradas.
function toJpeg(url) {
  return url.replace(/\.webp(\?.*)?$/i, ".jpg$1");
}

function buildDescription(post) {
  return post.og_description || post.custom_excerpt || post.excerpt || "";
}

async function sendToChannel(post) {
  const headers = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) headers["X-Api-Key"] = WAHA_API_KEY;

  // Com feature_image: preview de link com imagem JPEG que nós fornecemos.
  // Sem imagem: fallback para texto simples.
  const endpoint = post.feature_image ? "send/link-custom-preview" : "sendText";
  const body = post.feature_image
    ? {
        session: SESSION,
        chatId: CHANNEL_ID,
        text: post.url,
        linkPreviewHighQuality: true,
        preview: {
          url: post.url,
          title: post.title,
          description: buildDescription(post) || post.title,
          image: { url: toJpeg(post.feature_image) },
        },
      }
    : { session: SESSION, chatId: CHANNEL_ID, text: buildCaption(post) };

  const res = await fetch(`${WAHA_URL}/api/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`WAHA retornou ${res.status}: ${await res.text()}`);
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

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
