#!/usr/bin/env bash
# Deploy de produção sem deixar o servidor quebrado pela metade:
#   1. confere o ambiente (lê o .env sem executá-lo), o sudo e se o deploy anterior terminou
#   2. backup do banco (senha fora da linha de comando) e conferência do dump
#   3. instala e gera o build numa cópia isolada (.deploy-*): a API no ar continua usando o node_modules atual
#   4. só então para a API, aplica as migrations ("migrate deploy", nunca "dev"/"reset") e troca node_modules e dist
#   5. grava a versão em backend/.versao, reinicia e espera o /health responder com ela
# Se algo falhar, o script diz em que etapa parou e imprime o roteiro exato para voltar à versão anterior.
#
# Uso (no servidor, na pasta do projeto, depois do git pull):
#   SERVICO_API=gestao-api ./scripts/deploy-producao.sh
# Variáveis: SERVICO_API (obrigatória, unidade do systemd), PASTA_BACKUP (padrão ./backups),
#            URL_SAUDE (padrão http://127.0.0.1:3333/health)
# Arquivos de controle (fora do git): .versao-publicada = último commit publicado com sucesso;
#   .deploy-pendente = existe enquanto um deploy trocou arquivos e ainda não confirmou o /health.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
RAIZ="$PWD"
PASTA_BACKUP="${PASTA_BACKUP:-./backups}"
URL_SAUDE="${URL_SAUDE:-http://127.0.0.1:3333/health}"
ETAPA="início"
MIGRATION_RODOU=0
API_PARADA=0
TROCOU=0
ARQUIVO=""
URL_SEM_SENHA=""
STAGING=""
VERSAO_ANTERIOR="desconhecida"

falha() { echo "ERRO: $*" >&2; [ -n "$ARQUIVO" ] && ao_falhar 1; exit 1; }
passo() { ETAPA="$1"; echo; echo "==> $1"; }

roteiro_de_volta() {
  echo "  Para voltar à versão anterior ($VERSAO_ANTERIOR), nesta ordem:" >&2
  echo "    sudo systemctl stop $SERVICO_API" >&2
  if [ "$VERSAO_ANTERIOR" != "desconhecida" ]; then
    echo "    git checkout $VERSAO_ANTERIOR" >&2
  else
    echo "    git reflog   # ache o commit que estava no ar antes do pull e rode: git checkout <commit>" >&2
  fi
  if [ "$TROCOU" = 1 ]; then
    [ -d node_modules.anterior ] && echo "    rm -rf node_modules && mv node_modules.anterior node_modules" >&2
    [ -d frontend/dist.anterior ] && echo "    rm -rf frontend/dist && mv frontend/dist.anterior frontend/dist" >&2
    [ -d node_modules.anterior ] || echo "    npm ci --include=dev   # não havia node_modules anterior para restaurar" >&2
  else
    echo "    npm ci --include=dev   # dependências da versão anterior" >&2
  fi
  echo "    PGPASSWORD=... pg_restore --clean --if-exists --no-owner --dbname=\"$URL_SEM_SENHA\" \"$ARQUIVO\"" >&2
  [ "$VERSAO_ANTERIOR" != "desconhecida" ] && echo "    echo $VERSAO_ANTERIOR > backend/.versao" >&2
  echo "    rm -f .deploy-pendente && sudo systemctl start $SERVICO_API" >&2
}

ao_falhar() {
  local codigo=${1:-$?}
  [ "$BASH_SUBSHELL" -gt 0 ] && return  # o trap também dispara dentro dos ( ... ): avisa só uma vez, no shell principal
  echo >&2
  echo "ERRO: o deploy parou na etapa \"$ETAPA\" (código $codigo)." >&2
  if [ "$MIGRATION_RODOU" = 0 ]; then
    echo "Nada foi trocado: a API, o site e o banco seguem como estavam. Corrija e rode de novo." >&2
  elif [ "$TROCOU" = 0 ]; then
    # A migration falhou com a API parada. O código-fonte já é o novo (veio no git pull): religar sobe código
    # novo com dependências antigas sobre um banco talvez migrado pela metade. Melhor no ar do que fora, mas avisando
    sudo -n systemctl start "$SERVICO_API" >/dev/null 2>&1 \
      && echo "ATENÇÃO: a API foi religada com o código NOVO e as dependências ANTIGAS; o banco pode estar migrado pela metade." >&2 \
      || echo "ATENÇÃO: a API está PARADA (não religou)." >&2
    roteiro_de_volta
  else
    echo "ATENÇÃO: a versão nova já foi instalada e a API pode estar PARADA ou com erro (veja o status abaixo)." >&2
    systemctl is-active "$SERVICO_API" >&2 || true
    roteiro_de_volta
  fi
  [ -n "$ARQUIVO" ] && echo "  Backup do banco: $ARQUIVO" >&2
  echo "  Logs: journalctl -u ${SERVICO_API:-sua-api} -n 100" >&2
}
limpar() { [ -n "$STAGING" ] && rm -rf "$STAGING"; return 0; }
trap ao_falhar ERR
trap limpar EXIT

# Lê CHAVE=VALOR do .env sem executar nada, como o dotenv: aceita "export ", espaços em volta do "=", aspas externas e
# comentário no fim da linha (só fora das aspas); preserva &, espaços e $; a última ocorrência vence
ler_env() {
  local chave="$1" linha valor="" padrao="^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=[[:space:]]*(.*)$"
  while IFS= read -r linha || [ -n "$linha" ]; do
    linha="${linha%$'\r'}"
    [[ "$linha" =~ $padrao ]] || continue
    valor="${BASH_REMATCH[2]}"
    if [[ "$valor" =~ ^\"([^\"]*)\" || "$valor" =~ ^\'([^\']*)\' ]]; then
      valor="${BASH_REMATCH[1]}"
    else
      valor="${valor%%[[:space:]]#*}"
      valor="${valor%"${valor##*[![:space:]]}"}"
    fi
  done < .env
  printf '%s' "$valor"
}

passo "1/6 Conferindo o ambiente"
[ -n "${SERVICO_API:-}" ] || falha "defina SERVICO_API (unidade do systemd da API, ex.: SERVICO_API=gestao-api). Sem ela o script não consegue reiniciar e conferir a versão nova."
[ -f .env ] || falha ".env não encontrado na raiz do projeto."
# Um deploy anterior trocou os arquivos e não confirmou: o .anterior é a última versão boa e não pode ser apagado
[ ! -f .deploy-pendente ] || falha "o deploy anterior ($(cat .deploy-pendente)) não terminou: node_modules.anterior e frontend/dist.anterior guardam a última versão boa. Confira a API; se ela está ok, apague .deploy-pendente e rode de novo; senão, siga o roteiro de volta."
sudo -n true 2>/dev/null || falha "sudo pede senha: rode 'sudo -v' antes ou libere 'systemctl * $SERVICO_API' no sudoers."
for chave in NODE_ENV DATABASE_URL CORS_ORIGINS REDIS_URL VITE_API_URL; do
  printf -v "$chave" '%s' "$(ler_env "$chave")"
done
export NODE_ENV CORS_ORIGINS REDIS_URL VITE_API_URL   # DATABASE_URL só vai para quem precisa (migration)
[ "$NODE_ENV" = "production" ] || falha "NODE_ENV=production precisa estar no .env (hoje: '${NODE_ENV:-vazio}')."
[ -n "$DATABASE_URL" ] || falha "DATABASE_URL não definida no .env."
[ -n "$CORS_ORIGINS" ] || falha "CORS_ORIGINS não definida (ex.: https://agendar.suaempresa.com,https://painel.suaempresa.com)."
[ -n "$REDIS_URL" ] || falha "REDIS_URL não definida."
case "$VITE_API_URL" in /api|https://*) ;; *) falha "VITE_API_URL deve ser /api (atrás do nginx) ou https://..., hoje: '${VITE_API_URL:-vazio}'." ;; esac
for programa in pg_dump pg_restore curl node tar git; do command -v "$programa" >/dev/null || falha "$programa não instalado."; done
VERSAO_NOVA="$(git rev-parse --short=12 HEAD)"
# Versão que estava no ar: a do último deploy ok; no primeiro deploy, a gravada para o /health ou o commit antes do pull
if [ -f .versao-publicada ]; then VERSAO_ANTERIOR="$(cat .versao-publicada)"
elif [ -f backend/.versao ]; then VERSAO_ANTERIOR="$(cat backend/.versao)"
else VERSAO_ANTERIOR="$(git rev-parse --short=12 ORIG_HEAD 2>/dev/null || echo desconhecida)"
fi
git diff --quiet HEAD || echo "AVISO: há mudanças não commitadas; o /health vai mostrar $VERSAO_NOVA mesmo assim."
echo "Versão a publicar: $VERSAO_NOVA (anterior: $VERSAO_ANTERIOR)"
rm -rf "$RAIZ"/.deploy-??????   # cópias isoladas que sobraram de um deploy interrompido (levam o .env)

# Partes da URL para o pg_dump/pg_restore pelo ambiente (PG*): a senha nunca aparece no "ps".
# Em duas linhas: com "eval $(node ...)" uma falha do node passaria calada e o dump iria para o banco errado
partes="$(node -e '
  const u = new URL(process.argv[1].split("?")[0]);
  if (!u.hostname || u.pathname.length < 2) throw new Error("sem host ou banco");
  const q = (v) => "\x27" + String(v).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
  const d = decodeURIComponent;
  console.log(`PGHOST=${q(d(u.hostname))} PGPORT=${q(u.port || 5432)} PGUSER=${q(d(u.username))} PGPASSWORD=${q(d(u.password))} PGDATABASE=${q(d(u.pathname.slice(1)))}`);
  u.password = ""; console.log(`URL_SEM_SENHA=${q(u.toString())}`);
' "$DATABASE_URL" 2>/dev/null)" || falha "DATABASE_URL inválida (precisa de host e nome do banco)."
eval "$partes"
# Mesmo que o operador já tenha DATABASE_URL/PG* exportadas no shell, elas não seguem para o npm ci nem para o build
export -n DATABASE_URL PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE 2>/dev/null || true

passo "2/6 Backup do banco antes de qualquer mudança"
mkdir -p "$PASTA_BACKUP"
chmod 700 "$PASTA_BACKUP"
ARQUIVO_TMP="$PASTA_BACKUP/gestao-$(date +%Y%m%d-%H%M%S).dump"
(umask 077; PGHOST="$PGHOST" PGPORT="$PGPORT" PGUSER="$PGUSER" PGPASSWORD="$PGPASSWORD" PGDATABASE="$PGDATABASE" \
  pg_dump --format=custom --no-owner --file="$ARQUIVO_TMP") || { rm -f "$ARQUIVO_TMP"; falha "pg_dump falhou: deploy interrompido, nada foi mudado."; }
{ [ -s "$ARQUIVO_TMP" ] && pg_restore --list "$ARQUIVO_TMP" >/dev/null; } || { rm -f "$ARQUIVO_TMP"; falha "backup vazio ou ilegível: deploy interrompido, nada foi mudado."; }
chmod 600 "$ARQUIVO_TMP"
ARQUIVO="$ARQUIVO_TMP"
unset PGPASSWORD
echo "Backup conferido: $ARQUIVO"

passo "3/6 Instalação e build numa cópia isolada (a API atual segue no ar)"
STAGING="$(mktemp -d "$RAIZ/.deploy-XXXXXX")"
tar --exclude=./node_modules --exclude=./frontend/node_modules --exclude=./frontend/dist --exclude=./.git \
    --exclude=./backups --exclude='./.deploy-*' --exclude=./node_modules.anterior --exclude=./frontend/dist.anterior -cf - . \
  | tar -xf - -C "$STAGING"
(cd "$STAGING" && env -u DATABASE_URL -u PGPASSWORD NODE_ENV= npm ci --include=dev && (cd backend && npm run prisma:generate) && npm run build)
# Sem pipe: com pipefail, o "grep -q" fechando cedo podia matar o find (SIGPIPE) e esconder um .map
if [ -n "$(find "$STAGING/frontend/dist" -name '*.map' -print -quit)" ]; then falha "o build gerou source maps (.map): não publique."; fi

passo "4/6 Parando a API e aplicando as migrations (somente prisma migrate deploy)"
sudo -n systemctl stop "$SERVICO_API"
API_PARADA=1
MIGRATION_RODOU=1
(cd "$STAGING/backend" && DATABASE_URL="$DATABASE_URL" npm run prisma:deploy)

passo "5/6 Trocando dependências e site pela versão nova"
echo "$VERSAO_NOVA" > .deploy-pendente
rm -rf node_modules.anterior frontend/dist.anterior
TROCOU=1
[ -d node_modules ] && mv node_modules node_modules.anterior
mv "$STAGING/node_modules" node_modules
[ -d frontend/dist ] && mv frontend/dist frontend/dist.anterior
mv "$STAGING/frontend/dist" frontend/dist
echo "$VERSAO_NOVA" > backend/.versao   # o /health lê daqui (não depende de git nem do usuário do systemd)

passo "6/6 Subindo a API e conferindo saúde e versão"
sudo -n systemctl start "$SERVICO_API"
for _ in $(seq 1 30); do
  resposta="$(curl -fsS --max-time 3 "$URL_SAUDE" 2>/dev/null || true)"
  if node -e 'const r = JSON.parse(process.argv[1]); process.exit(r.status === "ok" && r.versao === process.argv[2] ? 0 : 1)' "${resposta:-null}" "$VERSAO_NOVA" 2>/dev/null; then
    echo "$VERSAO_NOVA" > .versao-publicada
    rm -f .deploy-pendente
    echo "API saudável na versão $VERSAO_NOVA ($URL_SAUDE)."
    echo "Deploy concluído."
    [ -d node_modules.anterior ] && echo "A versão anterior fica em node_modules.anterior e frontend/dist.anterior até o próximo deploy."
    echo "Recarregue o nginx se o arquivo dele mudou: sudo nginx -t && sudo systemctl reload nginx"
    exit 0
  fi
  sleep 2
done
falha "a API não respondeu ok com a versão $VERSAO_NOVA em $URL_SAUDE (última resposta: ${resposta:-nenhuma})."
