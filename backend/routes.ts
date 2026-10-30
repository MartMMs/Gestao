import { Router } from 'express';
import type { Eventos } from './lib/eventos';
import { ESCOPOS } from '../shared/escopos';
import { createEmpresaRouter } from './routes/empresaRoutes';
import { createColaboradoresRouter } from './routes/colaboradoresRoutes';
import { createAgendamentosRouter } from './routes/agendamentosRoutes';
import { createClientesRouter } from './routes/clientesRoutes';
import { createServicosRouter } from './routes/servicosRoutes';
import { createEscalaRouter } from './routes/escalaRoutes';
import { createRelatoriosRouter } from './routes/relatoriosRoutes';

// Monta a API interna (/api). Cada módulo cuida de um assunto.
export function createRouter(eventos: Eventos) {
  const router = Router();

  router.use(createEmpresaRouter(eventos));
  router.use(createColaboradoresRouter(eventos));
  router.use(createAgendamentosRouter(() => eventos.notificarMudanca(ESCOPOS.agenda)));
  router.use(createClientesRouter(() => eventos.notificarMudanca(ESCOPOS.clientes)));
  router.use(createServicosRouter(() => eventos.notificarMudanca(ESCOPOS.servicos)));
  router.use(createEscalaRouter(() => eventos.notificarMudanca(ESCOPOS.escala)));
  router.use(createRelatoriosRouter());

  return router;
}
