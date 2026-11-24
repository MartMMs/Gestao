#!/usr/bin/env bash
# Apresentação: publica o sistema que roda NESTE PC em subdomínios do seu domínio, pelo Cloudflare Tunnel
# (sem servidor e sem abrir porta). O portfólio na raiz do domínio não é tocado.
#   painel.<dominio>  -> portal da equipe (login)
#   agendar.<dominio> -> só o totem; o resto da API dá 404 (mesmo isolamento do nginx de produção)
# A API sobe em modo produção (cookie Secure, sem watch) e SÓ com um banco de demonstração: nunca o do .env.
#
# Uma vez só: túnel criado (credencial em ~/.cloudflared/<id>.json), CNAMEs painel/agendar -> <id>.cfargotunnel.com,
# Redis local rodando e o banco de demonstração preparado:
#   createdb gestao_demo
#   DATABASE_URL=postgresql://usuario:senha@localhost:5432/gestao_demo npm --prefix backend run prisma:deploy
#   DATABASE_URL=postgresql://usuario:senha@localhost:5432/gestao_demo npm --prefix backend run seed
# A cada apresentação (Ctrl+C encerra tudo):
#   DOMINIO=matheusmm.me DATABASE_URL_DEMO=postgresql://usuario:senha@localhost:5432/gestao_demo ./scripts/apresentacao.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

falha() { echo "ERRO: $*" >&2; exit 1; }
DOMINIO="${DOMINIO:?defina DOMINIO, ex.: DOMINIO=matheusmm.me}"
PAINEL="painel.$DOMINIO"
AGENDAR="agendar.$DOMINIO"
command -v cloudflared >/dev/null || falha "instale o cloudflared (ver README)."

# Banco: exige um de demonstração explícito e recusa o mesmo banco do .env (dados reais de clientes)
[ -n "${DATABASE_URL_DEMO:-}" ] || falha "defina DATABASE_URL_DEMO com um banco só de demonstração (ex.: .../gestao_demo). O banco do .env nunca é usado aqui."
# "#" e "?" confundiriam a leitura do nome (ex.: .../gestao#demo conecta no banco "gestao")
[[ "$DATABASE_URL_DEMO" != *"#"* && "$DATABASE_URL_DEMO" != *"?"* ]] || falha "DATABASE_URL_DEMO não pode ter '#' nem '?'."
nome_do_banco() { local u="${1%%\?*}"; printf '%s' "${u##*/}"; }
BANCO_DEMO="$(nome_do_banco "$DATABASE_URL_DEMO")"
BANCO_REAL="$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=[[:space:]]*//p' .env 2>/dev/null | tail -1 | tr -d "\"'" || true)"
[ -n "$BANCO_REAL" ] || [ ! -f .env ] || falha "não consegui ler DATABASE_URL do .env para garantir que o banco de demonstração é outro."
if [ -n "$BANCO_REAL" ] && [ "$BANCO_DEMO" = "$(nome_do_banco "$BANCO_REAL")" ]; then
  falha "DATABASE_URL_DEMO aponta para o mesmo banco do .env ($BANCO_DEMO). Use um banco separado, ex.: gestao_demo."
fi
[[ "$BANCO_DEMO" == *demo* ]] || falha "o nome do banco de demonstração precisa conter 'demo' (hoje: '$BANCO_DEMO'), para não publicar dados reais por engano."

# Túnel: usa TUNEL=<id> ou a única credencial em ~/.cloudflared; com 0 ou várias, pede para escolher
if [ -z "${TUNEL:-}" ]; then
  shopt -s nullglob
  credenciais=("$HOME"/.cloudflared/*-*-*-*-*.json)
  shopt -u nullglob
  [ "${#credenciais[@]}" -eq 1 ] || falha "encontrei ${#credenciais[@]} credenciais de túnel em ~/.cloudflared: defina TUNEL=<id do túnel>."
  TUNEL="$(basename "${credenciais[0]}" .json)"
fi
[ -f "$HOME/.cloudflared/$TUNEL.json" ] || falha "credencial ~/.cloudflared/$TUNEL.json não encontrada."

for porta in 3333 4173; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$porta") 2>/dev/null; then falha "a porta $porta já está em uso (outra API ou apresentação rodando?)."; fi
done

# Build com a API no mesmo endereço de cada site (o túnel separa /api e /socket.io)
export VITE_API_URL=/api VITE_SOCKET_URL=/ VITE_AUTOATENDIMENTO_HOST="$AGENDAR" VITE_PAINEL_HOST="$PAINEL" \
  VITE_AUTOATENDIMENTO_URL="https://$AGENDAR"
npm run build

CONFIG="$(mktemp)"
PIDS=()
encerrar() { [ "${#PIDS[@]}" -gt 0 ] && kill "${PIDS[@]}" 2>/dev/null; rm -f "$CONFIG"; }
trap encerrar EXIT
trap 'exit 130' INT TERM
# Regras em ordem: a primeira que casar vale. "http_status:404" responde 404 sem chegar ao sistema.
# A lista de rotas internas é a mesma do bloco "agendar" de docs/nginx-https.conf.example: mude nos dois.
cat > "$CONFIG" <<EOF
tunnel: $TUNEL
credentials-file: $HOME/.cloudflared/$TUNEL.json
ingress:
  - hostname: $AGENDAR
    path: ^/(login|logout|rh|admin|painel|supervisor|recepcao|equipe|relatorios|tv|totem)(/|$)
    service: http_status:404
  - hostname: $AGENDAR
    path: ^/(api/autoatendimento/|socket\.io/)
    service: http://127.0.0.1:3333
  - hostname: $AGENDAR
    path: ^/(api/|health)
    service: http_status:404
  - hostname: $AGENDAR
    service: http://127.0.0.1:4173
  - hostname: $PAINEL
    path: ^/(api/|socket\.io/|health)
    service: http://127.0.0.1:3333
  - hostname: $PAINEL
    service: http://127.0.0.1:4173
  - service: http_status:404
EOF

# API em modo produção, sem watch, no banco de demonstração (a variável do ambiente vence o .env)
(cd backend && exec env NODE_ENV=production DATABASE_URL="$DATABASE_URL_DEMO" REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}" \
  CORS_ORIGINS="https://$PAINEL,https://$AGENDAR" TRUST_PROXY=1 node ../node_modules/tsx/dist/cli.mjs server.ts) &
PIDS+=($!)
(cd frontend && exec node ../node_modules/vite/bin/vite.js preview --port=4173 --strictPort --host=127.0.0.1) &
PIDS+=($!)

echo "Esperando a API responder em /health..."
for _ in $(seq 1 30); do
  curl -fs --max-time 2 http://127.0.0.1:3333/health | grep -q '"ok"' && break
  kill -0 "${PIDS[0]}" 2>/dev/null || falha "a API parou ao subir (veja as mensagens acima: Redis ligado? banco de demonstração migrado?)."
  sleep 1
done
curl -fs --max-time 2 http://127.0.0.1:3333/health | grep -q '"ok"' || falha "a API não respondeu em 30 s; o túnel não foi aberto."

echo; echo "Painel: https://$PAINEL   Totem: https://$AGENDAR"; echo
cloudflared tunnel --no-autoupdate --config "$CONFIG" run &
PIDS+=($!)
wait "${PIDS[@]}"
