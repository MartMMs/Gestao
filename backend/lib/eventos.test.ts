import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as conectar, type Socket } from 'socket.io-client';
import { EVENTO_CLIENTE_AUSENTE, type AvisoAusencia } from '../../shared/eventosSocket';

// Sessão falsa: o "token" é o id do usuário; o papel vem desta tabela (no real, do banco)
const PAPEIS: Record<string, string> = { recepcao: 'receptionist', supervisora: 'supervisor', admin: 'admin', helena: 'collaborator', ana: 'collaborator' };
vi.mock('../auth', () => ({
  validarSessao: async (token: string) => (PAPEIS[token] ? { id: token, papel: PAPEIS[token], trocarSenha: false } : null),
  dadosDoToken: () => null,
}));
const { configurarSocket, criarEventos } = await import('./eventos');

let fechar: (() => Promise<void>) | null = null;
afterEach(async () => { await fechar?.(); fechar = null; });

const montar = async () => {
  const http = createServer();
  const io = new Server(http);
  configurarSocket(io, () => true);
  await new Promise<void>((ok) => http.listen(0, ok));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const clientes: Socket[] = [];
  const entrar = async (token?: string) => {
    const s = conectar(url, { auth: token ? { token } : {}, transports: ['websocket'], forceNew: true });
    clientes.push(s);
    await new Promise<void>((ok) => s.on('connect', () => ok()));
    const recebidos: AvisoAusencia[] = [];
    s.on(EVENTO_CLIENTE_AUSENTE, (a: AvisoAusencia) => recebidos.push(a));
    return recebidos;
  };
  fechar = async () => { clientes.forEach((c) => c.disconnect()); await new Promise((ok) => io.close(() => ok(null))); };
  return { eventos: criarEventos(io), entrar };
};

const aviso = (colaboradorId: string): AvisoAusencia => ({ agendamentoId: 'ag1', cliente: 'Maria', data: '11/12', horario: '10:30', colaboradorId });
const esperar = () => new Promise((ok) => setTimeout(ok, 150));

describe('aviso de cliente ausente (socket)', () => {
  it('chega à recepção, à supervisão e ao profissional do atendimento; nunca ao admin, a outro profissional ou a quem não logou', async () => {
    const { eventos, entrar } = await montar();
    const [recepcao, supervisora, admin, helena, ana, totem] = await Promise.all(['recepcao', 'supervisora', 'admin', 'helena', 'ana', undefined].map(entrar));
    eventos.avisarAusencia(aviso('helena'));
    await esperar();
    expect(recepcao).toHaveLength(1);
    expect(supervisora).toHaveLength(1);
    expect(helena).toHaveLength(1);
    expect(admin).toHaveLength(0);
    expect(ana).toHaveLength(0);
    expect(totem).toHaveLength(0);
  });

  it('admin que é o próprio profissional do agendamento também não recebe', async () => {
    const { eventos, entrar } = await montar();
    const admin = await entrar('admin');
    eventos.avisarAusencia(aviso('admin'));
    await esperar();
    expect(admin).toHaveLength(0);
  });

  it('quem muda de papel entra nas salas do papel novo depois de reconectar (supervisora promovida a admin deixa de receber)', async () => {
    const { eventos, entrar } = await montar();
    PAPEIS.supervisora = 'admin';
    try {
      const promovida = await entrar('supervisora');
      eventos.avisarAusencia(aviso('helena'));
      await esperar();
      expect(promovida).toHaveLength(0);
    } finally {
      PAPEIS.supervisora = 'supervisor';
    }
  });
});
