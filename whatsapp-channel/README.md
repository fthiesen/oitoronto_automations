# Postagem automática de posts no canal do WhatsApp

Automação que checa o blog da OiToronto via Ghost API e posta o próximo link
ainda não enviado no canal do WhatsApp, via [WAHA](https://waha.devlike.pro/).
O GitHub Actions roda nos horários agendados sem precisar do seu computador ligado.

## Como funciona

1. Busca os posts publicados do Ghost (ordem cronológica)
2. Compara com `posted.json` para descobrir quais ainda não foram ao canal
3. Posta o mais antigo dos pendentes no WhatsApp
4. Salva o registro em `posted.json` com commit automático

Se não houver post novo no horário, simplesmente não posta nada.

## 1. Subir o WAHA no Railway

O WAHA precisa rodar 24/7 (não pode ser GitHub Actions — o WhatsApp exige
conexão persistente). O Railway é uma boa opção se você já tem conta lá.

**Passos:**

1. No Railway, crie um novo projeto → **Deploy from Docker Image** →
   imagem: `devlikeapro/waha`
2. Adicione a variável de ambiente: `WAHA_API_KEY=escolha-uma-senha-forte`
3. Vá em **Volumes** e monte um volume em `/app/.sessions` — isso garante que
   a sessão do WhatsApp sobreviva a reinicializações do container
4. O Railway vai gerar um URL público (ex: `https://waha-production-xxxx.up.railway.app`)

## 2. Conectar o número de WhatsApp

1. Acesse `https://seu-url.up.railway.app` (interface do WAHA)
2. Crie uma sessão chamada `default` e escaneie o QR code com o WhatsApp
   do número administrador do canal OiToronto
3. Confirme que o status ficou `WORKING`

## 3. Descobrir o ID do canal

```bash
curl https://seu-url.up.railway.app/api/default/channels \
  -H "X-Api-Key: sua-senha"
```

Retorna algo como:
```json
[{ "id": "123456789012345@newsletter", "name": "OiToronto", "role": "ADMIN" }]
```

Guarde esse `id` — é o `WAHA_CHANNEL_ID`.

## 4. Configurar os Secrets no GitHub

Em **Settings → Secrets and variables → Actions** do repositório:

| Secret | Valor |
|---|---|
| `GHOST_ADMIN_API_KEY` | chave do Ghost Admin (já está no `.env` local) |
| `WAHA_URL` | URL do Railway (ex: `https://waha-production-xxxx.up.railway.app`) |
| `WAHA_API_KEY` | a senha que você definiu no Railway |
| `WAHA_CHANNEL_ID` | o `id` do canal do passo 3 |

## 5. Mover o workflow para o lugar certo

```bash
mkdir -p .github/workflows
cp whatsapp-channel/post-link.yml .github/workflows/whatsapp-post-link.yml
```

## 6. Horários de postagem

Configurados em `post-link.yml` (UTC — Toronto é UTC-4 no verão, UTC-5 no inverno):

| Horário Toronto (verão) | Cron (UTC) |
|---|---|
| 7:15am | `15 11 * * *` |
| 10:15am | `15 14 * * *` |
| 1:15pm | `15 17 * * *` |
| 4:15pm | `15 20 * * *` |
| 7:15pm | `15 23 * * *` |
| 10:00pm | `0 2 * * *` |

**Em novembro**, quando o horário de verão terminar, ajuste todos os horários
adicionando 1h (ex: `15 11` vira `15 12`).

## 7. Testar

Rode manualmente pela aba **Actions** do GitHub (botão "Run workflow"), ou localmente:

```bash
GHOST_ADMIN_API_KEY=... WAHA_URL=... WAHA_API_KEY=... WAHA_CHANNEL_ID=... node post-link.js
```

## Histórico de posts enviados

O arquivo `posted.json` registra todos os posts já enviados ao canal.
Não edite manualmente — ele é atualizado automaticamente pelo workflow.
