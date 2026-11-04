import { Prisma } from '@prisma/client';
import { travarChave } from './transacao';
import { normalizarNome } from '../../shared/validadores';

// Dois cadastros ativos com o mesmo nome confundem agenda, histórico e ficha de saúde: o sistema não deixa.
// A trava serializa cadastros simultâneos do mesmo nome; a comparação ignora acentos, caixa e espaços.
// Quem procura um cadastro pelo nome antes de criar pega a trava antes da busca: o envio simultâneo do mesmo cliente
// espera e então encontra o cadastro recém-criado, em vez de criar outro
export const travarNomeCliente = (tx: Prisma.TransactionClient, nome: string) => travarChave(tx, `cliente-nome:${normalizarNome(nome)}`);

export const clienteComMesmoNome = async (tx: Prisma.TransactionClient, nome: string, ignorarId?: string) => {
  const normalizado = normalizarNome(nome);
  await travarNomeCliente(tx, nome);
  // Sem pré-filtro no banco: ILIKE não ignora acento ("Ângela" x "Angela"); a comparação é toda em normalizarNome
  const candidatos = await tx.cliente.findMany({
    where: { removidoEm: null, ...(ignorarId ? { NOT: { id: ignorarId } } : {}) },
    select: { id: true, nome: true, codigo: true },
  });
  return candidatos.find((c) => normalizarNome(c.nome) === normalizado) ?? null;
};

export const NOME_CLIENTE_REMOVIDO = 'Cliente removido';

// onde: como escolher o cadastro existente na tela que recebeu o erro
export const mensagemNomeDuplicado = (existente: { nome: string; codigo: number }, onde: 'marcacao' | 'edicao' | 'carteira') =>
  `Já existe um cliente chamado "${existente.nome}" (código #${existente.codigo}). ${{
    marcacao: 'Selecione esse cadastro na busca',
    edicao: 'Para passar o atendimento para ele, escolha-o na lista do campo Cliente',
    carteira: 'Para juntar os dois, passe os atendimentos deste para ele (pelo campo Cliente de cada agendamento)',
  }[onde]} ou diferencie o nome (por exemplo, com o sobrenome).`;
