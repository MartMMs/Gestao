# 🌿 Sistema de Gestão de Spa e Clínica
<img width="594" height="279" alt="image" src="https://github.com/user-attachments/assets/7b2bbc47-7ee5-4b87-9c73-cd6823de96ef" />

Aplicacao full-stack para gestao de agendamentos, bloqueios, equipe, clientes e servicos.

**Versao atual: 1.1.0-beta.1** (pre-release). Notas completas em [docs/RELEASE_NOTES_1.1.0-beta.1.md](docs/RELEASE_NOTES_1.1.0-beta.1.md).

## Novidades da 1.1.0-beta.1

- **Totem em subdominio proprio:** o autoatendimento roda em `autoatendimento.<seu-dominio>` (ou no host definido
  em `VITE_AUTOATENDIMENTO_HOST`), sem tela de login e sem o codigo do portal da equipe. Como e outra origem, a
  sessao da equipe nunca fica acessivel no aparelho do totem. Botao "Recomecar" libera a reserva em aberto.
- **Agenda mais rapida:** cada coluna so redesenha quando os agendamentos daquele profissional mudam; o servidor
  devolve so o ultimo ano (`GET /agendamentos`, com `?desde=AAAA-MM-DD` validado).
- **Historico do cliente completo:** busca o periodo todo do cliente (com faltas), ate os 300 atendimentos mais
  recentes, e grava cada acesso na trilha de auditoria (`AcessoHistoricoCliente`: quem, qual cliente, IP, quando).
- **Tempo real com escopo:** o aviso `db_updated` informa o que mudou e cada tela recarrega so essas listas.
  Conexoes sem login (totem/TV) recebem apenas um aviso vazio, e so quando mudam agendamentos ou servicos.
- **Cargo x funcao de acesso:** o cadastro de profissional separa o *cargo* (rotulo livre, usado nas regras
  "Somente cargos") da *funcao de acesso* (o que a pessoa pode fazer no sistema).
- **Correcoes:** `VITE_API_URL`/`VITE_SOCKET_URL` voltam a valer no build de producao; linha vermelha da agenda
  cobre todas as colunas; painel da TV usa o fuso de Brasilia; mensagens (toasts) nao se apagam umas as outras.

## Mudancas depois da 1.1.0-beta.1 (ainda sem versao)

- **Usuario de acesso (login sem e-mail):** colaboradores e gestores podem entrar com identificador curto (`joao.silva`) alem do e-mail opcional, com unicidade case-insensitive no banco e mesma cota de tentativas de login.
- **Ficha de anamnese e operacao de balcao (LGPD):** ficha estruturada com exigencia opcional por empresa (`exigirAnamnese`). A recepcao ve o telefone completo (para confirmar presenca/ligar) e pode preencher ou atualizar a ficha no balcao sem visualizar nem apagar o historico clinico anterior; o colaborador ve telefone e CPF mascarados e acessa a ficha dos clientes da sua agenda (proximos 7 dias ou concluidos nos ultimos 30 dias).
- **Documentos legais integrados:** Termos de Uso e Politica de Privacidade acessiveis na tela de login, no rodape do portal e no totem de autoatendimento.
- **Sessao em cookie HttpOnly com protecao CSRF:** o token nao fica mais no navegador ao alcance do JavaScript;
  escritas exigem `X-Requested-With`; logout e inatividade revogam a sessao no servidor.
- **Agenda:** visoes Dia, Semana e Mes; arrastar o card remarca profissional e horario (com a versao do registro);
  legenda de cores.
- **Marcacoes simultaneas:** agenda, totem, escala, trocas de turno, desligamento e clientes gravam com travas por
  chave (profissional, agendamento, nome, CPF, cliente, sala, escala). Dois pedidos para o mesmo horario: um grava,
  o outro recebe 409. Espera longa por trava vira 503 com "tente de novo".
- **Auditoria e numeros:** historico de alteracoes (preco, comissao, cobranca do totem, exigencia e preenchimento de anamnese) para o administrador;
  dashboard e relatorio usam o mesmo calculo; falta conta o agendado vencido sem baixa.
- **Privacidade:** comissao escondida de quem nao e supervisor; ficha de cliente excluida nao recebe atendimento
  nem dados; consentimento versionado no totem; senha provisoria.
- **Codigo de reserva (`AG-XXXXXX`):** todo agendamento tem um, inclusive os criados pela equipe (aparece no titulo de
  "Editar Agendamento"). Na Agenda da Recepcao, digite o codigo na busca e tecle Enter: a agenda vai para o dia e abre a reserva.
- **Sem baixa:** botao "Sem baixa (N)" na Agenda da Recepcao (supervisao e recepcao) lista os atendimentos que ja
  terminaram e ninguem concluiu nem marcou falta; cada item abre o atendimento para dar baixa.
- **Folgas por escala:** no 6x1 o servidor aceita uma folga comum por semana (segunda a domingo) ao marcar, trocar ou
  replicar; so recusa quando a operacao acrescenta folga acima do limite (semana antiga com folga a mais continua
  editavel). Feriado e ausencias do RH (Ferias, Atestado medico, Afastamento) nao contam. No 5x2 as duas folgas podem
  cair em quaisquer dias. A Grade avisa antes de gravar.
- **Horario de trabalho no cadastro:** "Informar horario de trabalho" (entrada e saida) no Criar/Editar Usuario grava
  `turnoPadrao`; o calendario do RH, a Timeline e a agenda mostram esse horario nos dias de trabalho, sem gravar dia a dia.
  Sem ele, vale o horario da casa, como antes; um ajuste feito no dia tem prioridade.
- **Auditoria LGPD:** relatorio "Acessos ao historico de clientes" (quem abriu o historico de qual cliente, IP e quando).
- **Pagamento e WhatsApp pre-prontos:** adapters HTTP genericos, desligados por padrao (ver "Integracoes" abaixo).

> **Antes de subir esta versao:** faca backup do banco e rode `cd backend && npx prisma migrate deploy`
> (migrations de auditoria, comissao proporcional, troca de senha obrigatoria, consentimento do totem, usuario de acesso,
> horario padrao do colaborador `turnoPadrao` e referencia de pagamento `referenciaPagamento`).
> Veja os detalhes completos em [docs/ATUALIZACAO_ANAMNESE_ACESSO_SEGURANCA.md](docs/ATUALIZACAO_ANAMNESE_ACESSO_SEGURANCA.md).

## Guias detalhados

Para detalhes tecnicos completos de cada camada:

- Frontend: [frontend/README.md](frontend/README.md)
- Backend: [backend/README.md](backend/README.md)

## Estrutura atual

O projeto esta separado em frontend e backend dedicados.

- Frontend: `frontend/` (React + Vite)
- Backend: `backend/` (Express + Prisma + Socket.IO)
- Banco: `backend/prisma/schema.prisma`
- Regras compartilhadas (agenda, feriados, validacao de CPF/telefone, mascara de logs): `shared/`
- Orquestracao: raiz com scripts e automacoes em `scripts/`

## Estado da migracao

- Split fisico concluido: frontend e backend separados.
- Scripts da raiz atualizados para delegar para `frontend/` e `backend/`.
- Validacao executada apos split: lint, build, testes unitarios e smoke de inicializacao do backend.

## Primeiro uso

```bash
npm install
cp .env.example .env                 # preencha DATABASE_URL e JWT_SECRET (openssl rand -hex 32)
npm --prefix backend run prisma:deploy
npm --prefix backend run criar-usuario -- --usuario seu.usuario --nome "Seu Nome" --papel admin   # ou --email voce@empresa.com
```

O ultimo comando cria o primeiro administrador e pede a senha no terminal (sem eco e fora do historico
do shell). Use `--gerar-senha` para receber uma senha forte gerada uma unica vez. Uma conta existente so e
alterada com `--sobrescrever`.
Nao existem mais logins fixos no codigo: todo acesso exige usuario cadastrado com senha.
Novos colaboradores recebem uma senha provisoria aleatoria, exibida ao supervisor no cadastro.

## Como rodar hoje

```bash
npm run dev
```

Para subir frontend + backend juntos:

```bash
npm run dev:all
```

Para rodar apenas backend:

```bash
npm --prefix backend run dev
```

## Variaveis de ambiente

Veja `.env.example`. Principais:

- `DATABASE_URL`
- `JWT_SECRET` (obrigatoria, minimo 32 caracteres; o servidor nao sobe sem ela)
- `PORT` (padrao 3333)
- `CORS_ORIGINS` opcional (origens aceitas, separadas por virgula)
- `TRUST_PROXY` opcional (atras de nginx/proxy reverso)
- `PAYMENT_WEBHOOK_SECRET` (segredo HMAC do gateway; sem ele, pagamentos online ficam "aguardando pagamento")
- `PAYMENT_GATEWAY_URL` / `PAYMENT_GATEWAY_TOKEN` opcionais: adapter HTTP do gateway (vazio = pagamento na recepcao)
- `WHATSAPP_WEBHOOK_URL` / `WHATSAPP_WEBHOOK_TOKEN` opcionais: envio por WhatsApp (vazio = so log com telefone mascarado).
  Em producao as URLs precisam ser `https://` e o token e obrigatorio quando a URL existe
- `LIMPEZA_AGENDAMENTOS_DIAS` (padrao 30): agendamentos nunca concluidos apos esse prazo viram "no_show"; 0 desativa
- `E2E_PASSWORD` / `SEED_PASSWORD` (senhas dos usuarios de teste e de demonstracao)
- `VITE_API_URL` / `VITE_SOCKET_URL` opcionais (aplicadas no build do frontend)
- `VITE_AUTOATENDIMENTO_HOST` opcional: host(s) do totem, separados por virgula (vazio = qualquer host que comece com `autoatendimento.`)
- `VITE_AUTOATENDIMENTO_URL`: endereco do totem usado pelo botao da tela de login (sem ela, o totem abre dentro do portal, sem isolamento)

## Migrations do banco

Os comandos do Prisma rodam dentro de `backend/` (e onde fica `prisma/schema.prisma`):

```bash
cd backend && npx prisma migrate deploy
```

## Cabecalhos do servidor do frontend (producao)

O build ja traz a CSP em `<meta>`, mas a protecao contra iframe (clickjacking) so funciona como cabecalho HTTP.
No nginx que serve o `dist/`:

```nginx
add_header Content-Security-Policy "frame-ancestors 'none'" always;
add_header X-Frame-Options DENY always;
add_header X-Content-Type-Options nosniff always;
```

Defina `VITE_API_URL` no build de producao: sem ela, a CSP libera a porta 3333 de qualquer host.

## Totem em subdominio (producao)

1. Aponte o DNS de `autoatendimento.<seu-dominio>` para o mesmo servidor do portal e sirva o mesmo build do frontend.
2. Inclua as duas origens em `CORS_ORIGINS` (ex.: `https://app.suaempresa.com,https://autoatendimento.suaempresa.com`).
3. Gere o build com `VITE_AUTOATENDIMENTO_URL=https://autoatendimento.suaempresa.com`.

Use um subdominio, nao um caminho (`app.x.com/autoatendimento`): so outra origem isola a sessao da equipe.

## Pagamentos do autoatendimento

O botao "exigir pagamento" do painel do totem so passa a cobrar online quando ha um gateway conectado
(`PAYMENT_WEBHOOK_SECRET` configurado). Sem gateway, a reserva e confirmada com pagamento na recepcao e o painel avisa.
O codigo Pix exibido ao cliente vem do gateway (campo `pixCopiaECola` da reserva); o totem nunca monta um codigo
proprio, e o pagamento por cartao so aparece quando o gateway o oferecer (`cartaoOnlineDisponivel`).

O totem nunca marca um agendamento como pago sozinho. Com pagamento online ativo, o agendamento
fica `aguardando_pagamento` ate o gateway chamar `POST /api/autoatendimento/webhook-pagamento`
com os cabecalhos `x-webhook-timestamp` (segundos) e `x-webhook-signature` (HMAC-SHA256 de `timestamp.corpo` com
`PAYMENT_WEBHOOK_SECRET`). Chamadas com mais de 5 minutos ou com valor menor que o cobrado sao recusadas. Um pagamento que chega depois de a
reserva expirar marca o agendamento como `pago_apos_expirar` e avisa a equipe, para devolucao ou remarcacao.

## Validacao rapida

```bash
npm run lint        # TypeScript estrito no frontend, backend e shared
npm run build
npm run test:unit
```

Testes E2E (precisam do banco e de `E2E_PASSWORD` no `.env`):

```bash
## Integracoes (pagamento e WhatsApp)

Nenhum SDK de terceiro: os dois pontos de extensao sao adapters HTTP genericos, desligados enquanto a URL estiver vazia.
Para ligar um provedor real, aponte a URL para ele ou para um servico intermediario seu que traduza o contrato.

**Gateway de pagamento** (`backend/services/gatewayPagamento.ts`), ativo com `PAYMENT_GATEWAY_URL` e `PAYMENT_WEBHOOK_SECRET`:

- `POST PAYMENT_GATEWAY_URL` com `Authorization: Bearer PAYMENT_GATEWAY_TOKEN` e corpo `{ referencia, valor, descricao }`;
  resposta `{ pixCopiaECola, pixQrCode?, cartaoOnlineDisponivel? }` (8 s de limite).
- `referencia` e um id aleatorio da cobranca (gravado em `referenciaPagamento`); nunca o token da reserva do totem, que e credencial.
  O webhook devolve a mesma `referencia` (ou `agendamentoId`; se vierem os dois, precisam ser do mesmo agendamento).
- Gateway fora do ar: a reserva e liberada na hora e o totem recebe 503 ("tente de novo").

**WhatsApp** (`backend/services/whatsapp.ts`), ativo com `WHATSAPP_WEBHOOK_URL`:

- `POST WHATSAPP_WEBHOOK_URL` com `Authorization: Bearer WHATSAPP_WEBHOOK_TOKEN` e corpo `{ telefone, mensagem }`.
- Confirmacao da reserva do totem e lembrete 24 h antes (job a cada 10 min, ate 200 por rodada, uma rodada por vez;
  cada agendamento recebe no maximo um lembrete, marcado no Redis).
- As mensagens levam so o primeiro nome, dia, hora e o codigo da reserva: nada de servico, profissional ou sala.
- Antes de ligar: definir o formato do telefone que o provedor exige (ex.: `+55`) e o consentimento/opt-out (LGPD).

npm --prefix backend run seed:ci   # cria admin@serenidade.com, helena e ana com a senha E2E_PASSWORD
npm run test:e2e
```

Na 1.1.0-beta.1 a suite passou com 63 testes unitarios e 14/14 testes E2E (Playwright + Postgres 16).

## Execucao pelos scripts

```bash
./scripts/gestao-control.sh menu     # menu: Iniciar, Parar, Status
./scripts/gestao-control.sh start
./scripts/gestao-control.sh stop
./scripts/gestao-control.sh status
```

Atalhos locais (`Gestao-*.desktop`, tasks do VS Code) podem ser criados por cada um e ficam fora do repositorio (`.gitignore`).

## Fluxos criticos para teste manual

- Criar agendamento clicando na grade
- Editar agendamento normal
- Editar agendamento concluido (servicos)
- Criar bloqueio com realocacao
- Abrir e filtrar Proximos Agendamentos
- Testar agenda da recepcao em desktop e mobile

## Estado do projeto

- Split frontend/backend concluido.
- Refatoracao por features em andamento com entregas principais aplicadas.
- Pendencias de consolidacao:
   - conectar provedores reais de pagamento e WhatsApp (pontos de extensao prontos e desligados por padrao; ver BLG-014/015)

## Documentacao relacionada

- `docs/ATUALIZACAO_ANAMNESE_ACESSO_SEGURANCA.md` - documentacao detalhada da atualizacao de usuario de acesso, ficha de anamnese, LGPD operacional e seguranca
- `docs/RELEASE_NOTES_1.1.0-beta.1.md` - notas da versao atual
- `docs/BACKLOG_ATIVO.md` - pendencias em aberto
- `docs/arquivo/` - planos e checklists de fases anteriores (historico; nao refletem a estrutura atual)
