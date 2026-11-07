# Documentação da Atualização — Usuário de Acesso, Ficha de Anamnese, LGPD Operacional e Segurança

Data: 07/11/2026

## 1. Visão Geral

Esta atualização entrega o login por **usuário de acesso** (sem obrigatoriedade de e-mail), a gestão completa da **Ficha de Anamnese** (com opção de exigência obrigatória por empresa), os **Documentos Legais** integrados ao portal e ao totem, o refinamento das **regras operacionais de privacidade (LGPD)** para Recepção e Colaboradores, e **22 correções de segurança, UX, manutenibilidade e desempenho** validadas por banca de revisão.

---

## 2. Regras de Acesso e Privacidade por Papel (LGPD + Operação de Balcão)

| Recurso / Dado | Colaborador (`collaborator`) | Recepção (`receptionist`) | Supervisão / Admin (`supervisor` / `admin`) |
| :--- | :--- | :--- | :--- |
| **Telefone do cliente** | Mascarado (`(**) *****-**XX`) | **Completo** (para confirmação/ligação) e editável | **Completo** e editável |
| **CPF do cliente** | Mascarado (`***.***.***-XX`) | Mascarado (`***.***.***-XX`) | **Completo** e editável |
| **Leitura da Ficha de Saúde (`observacao`)** | Liberada para clientes da própria agenda (próximos **7 dias** ou concluídos nos últimos **30 dias**, inclusive agendamentos criados pelo próprio colaborador), exceto reservas do totem sem check-in | **Oculta** (`observacao: null`, `acessoSaude: false`); exibe apenas se o cliente já possui ficha (`temAnamnese`) | **Completa** (`acessoSaude: true`) |
| **Preenchimento / Atualização da Ficha (`__ANAMNESE_JSON__`)** | Permitido apenas para clientes com `acessoSaude: true` (`403` fora da janela) | **Permitido no balcão** (cria ou substitui apenas o bloco `__ANAMNESE_JSON__` sem exibir nem apagar anotações médicas anteriores ou declarações do totem) | **Completo** (ficha estruturada e anotações livres) |

### Detalhes Técnicos da Atualização Cega pela Recepção (`atualizarSomenteFichaJson`)
- Quando a Recepção preenche ou atualiza a ficha de anamnese de um cliente no balcão (`PUT /api/clientes/:id` ou durante `POST`/`PUT /api/agendamentos`), o backend utiliza `atualizarSomenteFichaJson(observacaoAtual, fichaEnviada)` em `shared/anamnese.ts`.
- O servidor extrai exclusivamente o bloco `__ANAMNESE_JSON__` válido, ignorando qualquer texto livre enviado por quem não possui `veSaude`, e preserva integralmente a nota clínica anterior da supervisão/profissional e as linhas `[Anamnese Autoatendimento AAAA-MM-DD]: ...` gravadas pelo totem.
- A resposta HTTP para a Recepção continua passando por `prepararCliente(atualizado, req, false)`, mantendo `observacao: null` para não expor dados clínicos pretéritos.

---

## 3. Novas Funcionalidades

1. **Usuário de Acesso (`Colaborador.usuario`)**:
   - Contas da equipe podem entrar com identificador curto (`joao.silva`) além do e-mail opcional.
   - Unicidade insensível a maiúsculas/minúsculas garantida por índice funcional no PostgreSQL e trava transacional (`travarUsuarioColaborador`).
   - Conta que possui usuário e e-mail compartilha a mesma cota de tentativas de login (sem duplicar limite de força bruta).
   - Trocar o próprio usuário ou e-mail exige confirmação da senha atual, renova a sessão da aba atual e encerra sessões em outros aparelhos.

2. **Ficha de Anamnese Obrigatória (Configuração da Empresa)**:
   - Nova chave `exigirAnamnese` na configuração da empresa (`PUT /api/empresa/config`), auditada em `AuditoriaConfig` (`acao: 'empresa.anamnese'`).
   - Primeiro preenchimento da ficha de um cliente é registrado na trilha de auditoria (`acao: 'cliente.anamnese'`).

3. **Documentos Legais (Termos de Uso e Política de Privacidade)**:
   - Disponíveis sem login na tela inicial, no rodapé do portal e na etapa de identificação do totem (`shared/documentosLegais.ts` e `frontend/src/components/DocumentosLegais.tsx`).

---

## 4. Correções de Segurança, UX e Performance (Banca de 5 Revisores)

### Segurança e Integridade (Crítico / Alto)
- **Bloqueio de IDOR em `PUT /api/clientes/:id`** (`backend/routes/clientesRoutes.ts`): colaboradores sem `veSaude` recebem `403 Forbidden`, e o payload de resposta respeita o nível de acesso do requisitante (`prepararCliente(atualizado, req, veSaude)`).
- **Proteção contra forja de declaração do totem em agendamentos** (`backend/routes/agendamentosRoutes.ts`): `lerObservacao` valida `forjaFichaDoTotem` em `POST` e `PUT /api/agendamentos`.
- **Impedimento de remoção de ficha obrigatória** (`backend/routes/agendamentosRoutes.ts`): `resolverCliente` impede apagar a ficha de anamnese no `PUT /api/agendamentos/:id` quando `exigirAnamnese` está ativo, mesmo sem trocar de cliente.
- **Validação estrita de estrutura e tipos da ficha** (`shared/anamnese.ts` e `frontend/src/utils/anamneseUtils.ts`): `fichaPreenchida` rejeita chaves desconhecidas e listas com itens não-textuais, e `parseClientObservation` normaliza `caracteristicas` e `medicamentos` evitando falhas de renderização.
- **Revogação persistente ao desligar colaborador com histórico** (`backend/routes/colaboradoresRoutes.ts`): `DELETE /api/colaboradores/:id` incrementa `tokenVersao` e limpa `sessaoId` (`INVALIDAR_SESSOES`) também quando o colaborador é apenas desativado (`ativo: false`).

### Usabilidade e Fluxos (Crítico / Alto / Médio)
- **Limpeza de estado no `BookingModal`** (`frontend/src/features/appointments/components/BookingModal.tsx`): alternar para `"Novo Cliente"` ou limpar a busca reseta nome, telefone, CPF, observação e ficha do cliente selecionado anteriormente.
- **Persistência de Alergias e Preferências na edição de cliente** (`frontend/src/features/clients/components/SupervisorClientesTab.tsx`): edições feitas no modal `"Editar Cliente"` atualizam o bloco estruturado da ficha e refletem nos badges da listagem e no histórico.
- **Regra de elegibilidade por profissional no `BookingModal`**: respeita `modoElegibilidade === 'profissional'` e `profissionaisPermitidos`.
- **Isolamento de clique em `"Concluir Atendimento"`** (`frontend/src/components/CollaboratorView.tsx`): `e.stopPropagation()` evita abrir o modal de edição ao concluir um atendimento na grade.
- **Reversão de estado otimista em falhas da Escala** (`usePlanejamentoEscala.ts` e `SupervisorPlanejamentoTab.tsx`): falhas de rede/servidor ao salvar dia, trocar ou replicar turnos desfazem a alteração local e exibem alerta de erro claro.
- **Preservação de rascunho ao trocar horário no Totem e limpeza ao desmontar** (`AutoatendimentoView.tsx`).
- **Desacoplamento entre Folga em Lote e Dias de Contrato** (`SupervisorEquipeTab.tsx`): selecionar `"Folga"` para uma data avulsa em lote não limpa os dias semanais de trabalho do contrato do colaborador.

### Desempenho e Manutenibilidade
- **Eliminação de N+1 queries de interjornada CLT no Totem** (`backend/services/agendaService.ts` e `backend/routes/autoatendimentoRoutes.ts`): `GET /api/autoatendimento/disponibilidade` pré-carrega os agendamentos da janela de 48h e valida a interjornada de 11h em memória (`verificarCLTInterjornadaEmMemoria`).
- **Remoção de leitura duplicada da carteira de clientes no Totem** (`backend/services/autoatendimentoService.ts`).

---

## 5. Instruções de Implantação (Deploy)

Antes de iniciar a nova versão do servidor em produção ou homologação, aplique as migrations pendentes no PostgreSQL:

```bash
npm --prefix backend run prisma:deploy
```

Migrations incluídas:
- `20261106120000_usuario_acesso`: adiciona coluna `usuario` e índice único case-insensitive em `Colaborador`, permitindo `email` nulo.
- `20261106130000_usuario_formato`: adiciona constraint `Colaborador_usuario_formato_chk` e obrigatoriedade de ao menos uma credencial (`email` ou `usuario`).
