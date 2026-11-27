import { test, expect } from '@playwright/test';
import { CONTAS, apagarClienteDeTeste, apiBase, authHeaders } from './credenciais';

/**
 * Regras de permissão e LGPD da 16ª banca: nome da empresa só o admin muda; o pedido de não receber lembretes no
 * WhatsApp é gravado pela recepção (e pela supervisão) e ignorado para o profissional.
 */

const sufixo = () => Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');

test('nome da empresa: supervisor não muda (403); reenviar o mesmo nome passa para supervisor e admin', async ({ request }) => {
  const supervisor = await authHeaders(request, CONTAS.supervisor);
  const admin = await authHeaders(request, CONTAS.admin);
  const atual = (await (await request.get(`${apiBase()}/empresa/config`)).json()) as { nomeEmpresa: string };

  const tentativa = await request.put(`${apiBase()}/empresa/config`, { headers: supervisor, data: { nomeEmpresa: `${atual.nomeEmpresa} Outra` } });
  expect(tentativa.status(), await tentativa.text()).toBe(403);
  expect((await tentativa.json()).erro).toContain('Apenas o administrador');

  for (const headers of [supervisor, admin]) {
    const mesmo = await request.put(`${apiBase()}/empresa/config`, { headers, data: { nomeEmpresa: atual.nomeEmpresa } });
    expect(mesmo.status(), await mesmo.text()).toBe(200);
  }
  const depois = (await (await request.get(`${apiBase()}/empresa/config`)).json()) as { nomeEmpresa: string };
  expect(depois.nomeEmpresa).toBe(atual.nomeEmpresa);
});

test('cor do sistema: supervisor não muda (403); formato inválido é recusado (400)', async ({ request }) => {
  const supervisor = await authHeaders(request, CONTAS.supervisor);
  const admin = await authHeaders(request, CONTAS.admin);
  const outra = await request.put(`${apiBase()}/empresa/config`, { headers: supervisor, data: { corTemaPrimaria: '#123456' } });
  expect(outra.status(), await outra.text()).toBe(403);
  const invalida = await request.put(`${apiBase()}/empresa/config`, { headers: admin, data: { corTemaPrimaria: 'red; background:url(x)' } });
  expect(invalida.status(), await invalida.text()).toBe(400);
});

test('opt-out do WhatsApp: recepção marca e desmarca; o profissional não consegue', async ({ request }) => {
  const supervisor = await authHeaders(request, CONTAS.supervisor);
  const recepcao = await authHeaders(request, CONTAS.recepcao);
  const colaboradora = await authHeaders(request, CONTAS.colaboradora);
  const nome = `Optout Banca ${sufixo()}`;
  const criado = await request.post(`${apiBase()}/clientes`, { headers: supervisor, data: { nome, telefone: '11987650000', naoReceberWhatsapp: true } });
  expect(criado.status(), await criado.text()).toBe(201);
  const cliente = (await criado.json()) as { id: string; naoReceberWhatsapp: boolean };
  const lerOptout = async () => ((await (await request.get(`${apiBase()}/clientes`, { headers: supervisor })).json()) as Array<{ id: string; naoReceberWhatsapp: boolean }>)
    .find((c) => c.id === cliente.id)?.naoReceberWhatsapp;
  try {
    expect(cliente.naoReceberWhatsapp).toBe(true);

    const desmarca = await request.put(`${apiBase()}/clientes/${cliente.id}`, { headers: recepcao, data: { naoReceberWhatsapp: false } });
    expect(desmarca.status(), await desmarca.text()).toBe(200);
    expect(await lerOptout()).toBe(false);

    const marca = await request.put(`${apiBase()}/clientes/${cliente.id}`, { headers: recepcao, data: { naoReceberWhatsapp: true } });
    expect(marca.status(), await marca.text()).toBe(200);
    expect(await lerOptout()).toBe(true);

    // Profissional que não atende o cliente nem chega a editar; o opt-out continua como estava
    const profissional = await request.put(`${apiBase()}/clientes/${cliente.id}`, { headers: colaboradora, data: { naoReceberWhatsapp: false } });
    expect(profissional.status()).toBe(403);
    expect(await lerOptout()).toBe(true);
  } finally {
    await apagarClienteDeTeste(request, nome);
  }
});

test('mensagens do lembrete: só o admin salva; chave errada é recusada; a confirmação 1/2 é gravada', async ({ request }) => {
  const admin = await authHeaders(request, CONTAS.admin);
  const supervisor = await authHeaders(request, CONTAS.supervisor);
  const antes = (await (await request.get(`${apiBase()}/whatsapp/mensagens`, { headers: admin })).json()) as { mensagens: string[]; pedeConfirmacao: boolean };
  try {
    expect((await request.put(`${apiBase()}/whatsapp/mensagens`, { headers: supervisor, data: { mensagens: ['Oi {nome}'] } })).status()).toBe(403);

    const errada = await request.put(`${apiBase()}/whatsapp/mensagens`, { headers: admin, data: { mensagens: ['Oi {nomi}'] } });
    expect(errada.status()).toBe(400);
    expect((await errada.json()).erro).toContain('{nomi}');

    const certa = await request.put(`${apiBase()}/whatsapp/mensagens`, { headers: admin, data: { mensagens: ['Oi {nome}, até {horario}'], pedeConfirmacao: true } });
    expect(certa.status(), await certa.text()).toBe(200);
    const gravado = await (await request.get(`${apiBase()}/whatsapp/mensagens`, { headers: admin })).json();
    expect(gravado).toEqual({ mensagens: ['Oi {nome}, até {horario}'], pedeConfirmacao: true });
  } finally {
    await request.put(`${apiBase()}/whatsapp/mensagens`, { headers: admin, data: antes });
  }
});
