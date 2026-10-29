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
npm --prefix backend run criar-usuario -- --email voce@empresa.com --nome "Seu Nome" --papel admin
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
- `LIMPEZA_AGENDAMENTOS_DIAS` (padrao 30): agendamentos nunca concluidos apos esse prazo viram "no_show"; 0 desativa
- `E2E_PASSWORD` / `SEED_PASSWORD` (senhas dos usuarios de teste e de demonstracao)
- `VITE_API_URL` / `VITE_SOCKET_URL` opcionais (aplicadas no build do frontend)
- `VITE_AUTOATENDIMENTO_HOST` opcional: host(s) do totem, separados por virgula (vazio = qualquer host que comece com `autoatendimento.`)
- `VITE_AUTOATENDIMENTO_URL`: endereco do totem usado pelo botao da tela de login (sem ela, o totem abre dentro do portal, sem isolamento)

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
   - tela para consultar a trilha de auditoria de acessos ao historico de clientes
   - filtrar agenda para destacar somente profissionais em folga (regra final de exibicao)
   - permitir ajuste de horario de trabalho pelo Supervisor com persistencia na listagem
   - continuar saneamento de `any` residual em `SupervisorView` e `SupervisorPlanejamentoTab` (props ainda genericas)
   - integrar um gateway de pagamento real ao webhook assinado
   - finalizar adocao de hooks/contexto compartilhado em todos os fluxos do Supervisor

## Documentacao relacionada

- `docs/RELEASE_NOTES_1.1.0-beta.1.md` - notas da versao atual
- `docs/BACKLOG_ATIVO.md` - pendencias em aberto
- `docs/arquivo/` - planos e checklists de fases anteriores (historico; nao refletem a estrutura atual)
