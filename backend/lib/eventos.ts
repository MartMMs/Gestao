import { Server } from 'socket.io';
import { dadosDoToken, validarSessao } from '../auth';
import { ESCOPOS_PUBLICOS, type EscopoMudanca } from '../../shared/escopos';

// Sala dos dispositivos logados (equipe). Totens e TVs conectam sem token e só recebem avisos públicos.
const SALA_EQUIPE = 'equipe';
const salaUsuario = (usuarioId: string) => `usuario:${usuarioId}`;
const salaSessao = (jti: string) => `sessao:${jti}`;

/**
 * Autentica as conexões do socket. Token é opcional (o totem é público), mas se for enviado precisa ser válido.
 * Conexões autenticadas entram na sala da equipe.
 */
export const configurarSocket = (io: Server) => {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (token === undefined || token === null || token === '') return next();
    try {
      const usuario = typeof token === 'string' ? await validarSessao(token) : null;
      if (!usuario) return next(new Error('Sessão expirada. Faça login novamente.'));
      socket.data.usuario = usuario;
      // Salas por sessão e por usuário: logout, troca de senha e desativação derrubam o socket na hora
      const dados = dadosDoToken(token as string);
      const salas = [SALA_EQUIPE, salaUsuario(usuario.id), ...(dados?.jti ? [salaSessao(dados.jti)] : [])];
      await socket.join(salas);
      // O socket não sobrevive ao token: cai quando ele expira
      if (dados?.exp) {
        const restanteMs = Math.max(0, dados.exp * 1000 - Date.now());
        const timer = setTimeout(() => socket.disconnect(true), Math.min(restanteMs, 2 ** 31 - 1));
        socket.on('disconnect', () => clearTimeout(timer));
      }
      next();
    } catch (error) {
      next(error as Error);
    }
  });
};

/**
 * Único ponto de emissão de eventos em tempo real. Os eventos públicos não carregam nada que a API pública
 * já não exponha; detalhes da agenda vão só para a equipe.
 */
export const criarEventos = (io: Server) => ({
  // Algo mudou: os dispositivos recarregam pela API (o evento não carrega dados).
  // A equipe recebe quais listas mudaram. Conexões sem login recebem um aviso vazio só quando mudam
  // agendamentos ou serviços (ESCOPOS_PUBLICOS); mudanças só de escala ou de clientes não chegam a elas.
  notificarMudanca: (escopos?: readonly EscopoMudanca[]) => {
    io.to(SALA_EQUIPE).emit('db_updated', escopos ? { escopos } : {});
    if (!escopos || escopos.some((escopo) => ESCOPOS_PUBLICOS.includes(escopo))) {
      io.except(SALA_EQUIPE).emit('db_updated', {});
    }
  },
  emitirConfigEmpresa: (config: unknown) => io.emit('empresa:config_atualizada', config),
  emitirConfigAutoatendimento: (config: unknown) => io.emit('autoatendimento:config_atualizada', config),
  avisarEquipe: (evento: string, dados: unknown) => io.to(SALA_EQUIPE).emit(evento, dados),
  // Logout: derruba os sockets daquela sessão
  encerrarSessao: (jti: string) => io.in(salaSessao(jti)).disconnectSockets(true),
  // Troca de senha/e-mail ou desativação: derruba todos os sockets do usuário
  encerrarSessoesDoUsuario: (usuarioId: string) => io.in(salaUsuario(usuarioId)).disconnectSockets(true),
});

export type Eventos = ReturnType<typeof criarEventos>;
