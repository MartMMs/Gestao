#!/usr/bin/env bash
# Deploy de produção, na ordem segura: confere o ambiente, faz backup do banco, instala, aplica as migrations
# (só "migrate deploy": nunca "migrate dev" nem "reset" em produção), gera o build e confere a saúde da API.
#
# Uso (no servidor, na pasta do projeto, depois do git pull):
#   SERVICO_API=gestao-api ./scripts/deploy-producao.sh
# Variáveis:
#   SERVICO_API   unidade do systemd que roda a API (ex.: gestao-api). Vazio = o script só avisa para reiniciar.
#   PASTA_BACKUP  onde guardar o dump (padrão: ./backups). Mantenha fora do diretório servido pelo nginx.
#   URL_SAUDE     padrão http://127.0.0.1:3333/health
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PASTA_BACKUP="${PASTA_BACKUP:-./backups}"
URL_SAUDE="${URL_SAUDE:-http://127.0.0.1:3333/health}"

falha() { echo "ERRO: $*" >&2; exit 1; }
passo() { echo; echo "==> $*"; }

passo "1/6 Conferindo o ambiente"
[ -f .env ] || falha ".env não encontrado na raiz do projeto."
set -a; . ./.env; set +a
[ "${NODE_ENV:-}" = "production" ] || falha "NODE_ENV=production precisa estar no .env (hoje: '${NODE_ENV:-vazio}')."
[ -n "${DATABASE_URL:-}" ] || falha "DATABASE_URL não definida."
[ -n "${CORS_ORIGINS:-}" ] || falha "CORS_ORIGINS não definida (ex.: https://agendar.suaempresa.com,https://painel.suaempresa.com)."
[ -n "${REDIS_URL:-}" ] || falha "REDIS_URL não definida."
case "${VITE_API_URL:-}" in /api|https://*) ;; *) falha "VITE_API_URL deve ser /api (atrás do nginx) ou https://..., hoje: '${VITE_API_URL:-vazio}'." ;; esac
command -v pg_dump >/dev/null || falha "pg_dump não instalado (sudo apt install postgresql-client)."

passo "2/6 Backup do banco antes de qualquer mudança"
mkdir -p "$PASTA_BACKUP"
chmod 700 "$PASTA_BACKUP"
ARQUIVO="$PASTA_BACKUP/gestao-$(date +%Y%m%d-%H%M%S).dump"
# pg_dump não entende o "?schema=" do Prisma na URL
pg_dump --format=custom --no-owner --dbname="${DATABASE_URL%%\?*}" --file="$ARQUIVO"
[ -s "$ARQUIVO" ] || falha "backup vazio: deploy interrompido."
chmod 600 "$ARQUIVO"
echo "Backup: $ARQUIVO (restaurar: pg_restore --clean --no-owner --dbname=\"\$DATABASE_URL\" $ARQUIVO)"

passo "3/6 Instalando dependências exatamente como no package-lock"
npm ci

passo "4/6 Migrations (somente prisma migrate deploy)"
(cd backend && npm run prisma:deploy && npm run prisma:generate)

passo "5/6 Build limpo do frontend"
rm -rf frontend/dist
npm run build
if find frontend/dist -name '*.map' | grep -q .; then falha "o build gerou source maps (.map): não publique."; fi

passo "6/6 Reiniciando a API e conferindo a saúde"
if [ -n "${SERVICO_API:-}" ]; then
  sudo systemctl restart "$SERVICO_API"
else
  echo "SERVICO_API não definida: reinicie a API agora pelo gerenciador que você usa (systemd, pm2...)."
fi
for tentativa in $(seq 1 30); do
  if curl -fsS --max-time 3 "$URL_SAUDE" | grep -q '"ok"'; then
    echo "API saudável ($URL_SAUDE)."
    echo "Deploy concluído. Recarregue o nginx se o arquivo dele mudou: sudo nginx -t && sudo systemctl reload nginx"
    exit 0
  fi
  sleep 2
done
falha "a API não respondeu ok em $URL_SAUDE. Veja os logs (journalctl -u \${SERVICO_API:-sua-api} -n 100). Backup em $ARQUIVO."
