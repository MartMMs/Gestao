# Arquitetura de Features

A pasta src/features organiza o sistema por dominio de negocio.

Principio:
- Cada feature concentra seus componentes, tipos, servicos e regras.
- Importacoes antigas podem continuar via arquivos de compatibilidade (re-export) enquanto a migracao acontece.

Estrutura recomendada:
- src/features/<dominio>/components
- src/features/<dominio>/hooks
- src/features/<dominio>/services
- src/features/<dominio>/types
- src/features/<dominio>/utils
- src/features/<dominio>/index.ts

Status atual:
- appointments: ativo com services/types/utils/components/hooks e utilitarios aplicados nos fluxos principais de agenda.
- clients: componentes (SupervisorClientesTab) em uso na aba de clientes do SupervisorView.
- services: iniciado com componentes (SupervisorServicosTab) e uso ativo na aba de servicos do SupervisorView.
- team: iniciado com componentes (SupervisorEquipeTab) e uso ativo na aba de equipe do SupervisorView.
- dashboard: iniciado com componentes (SupervisorDashboardTab) e uso ativo na aba de dashboard do SupervisorView.
- scale: iniciado com componentes (SupervisorEscalaTab) e uso ativo na aba de escala do SupervisorView.
- planning: SupervisorPlanejamentoTab e componentes auxiliares (calendario/timeline/popover); estado e regras no hook usePlanejamentoEscala.

Proxima etapa sugerida:
- consolidar hooks e regras de dominio (utils/services) dentro das features ja migradas (ex.: tirar o formulario de servicos do SupervisorView).

Regras compartilhadas com o backend ficam em `shared/` na raiz e sao importadas por `@shared/...`.
