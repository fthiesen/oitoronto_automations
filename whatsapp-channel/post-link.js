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
const POST_TEMPLATE = process.env.POST_TEMPLATE || "{url}";

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
  const url =
    `${GHOST_URL}/ghost/api/admin/posts/` +
    `?limit=1&order=published_at%20asc` +
    `&filter=status:published%2Btag:-hash-whatsapp-posted` +
    `&include=tags`;
  const res = await fetch(url, { headers: { Authorization: `Ghost ${jwt}` } });
  if (!res.ok) throw new Error(`Ghost API retornou ${res.status}: ${await res.text()}`);
  const { posts } = await res.json();
  return posts[0] || null;
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

  const text = POST_TEMPLATE.replace("{url}", post.url).replace("{title}", post.title);

  const headers = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) headers["X-Api-Key"] = WAHA_API_KEY;

  const res = await fetch(`${WAHA_URL}/api/sendText`, {
    method: "POST",
    headers,
    body: JSON.stringify({ session: SESSION, chatId: CHANNEL_ID, text }),
  });

  if (!res.ok) throw new Error(`WAHA retornou ${res.status}: ${await res.text()}`);

  console.log(`Postado: ${post.title} — ${post.url}`);
  await markAsPosted(jwt, post);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
