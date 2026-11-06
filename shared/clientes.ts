// Cadastro de cliente (manual e importação por planilha): limpeza e validação compartilhadas. A API é quem decide;
// o frontend usa as mesmas regras só para avisar antes.
import { MENSAGEM_CPF_INVALIDO, MENSAGEM_TELEFONE_INVALIDO, apenasDigitos, cpfValido, normalizarNome, normalizarTelefone, telefoneValido } from './validadores';

export const LIMITE_NOME_CLIENTE = 120;
export const LIMITE_EMAIL = 120;
export const MAX_LINHAS_IMPORTACAO = 500;
export const MENSAGEM_EMAIL_INVALIDO = 'E-mail inválido. Ex.: nome@provedor.com.br';

// Caracteres de controle, de largura zero e de direção de texto (usados para esconder ou disfarçar conteúdo)
const INVISIVEIS = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;

// Texto vindo de fora (formulário ou planilha): sem invisíveis, espaços colapsados, sem espaços nas pontas
export const limparTexto = (valor: unknown) => (typeof valor === 'string' || typeof valor === 'number' ? String(valor) : '')
  .normalize('NFC')
  .replace(INVISIVEIS, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Nome: começa por letra (bloqueia fórmula de planilha: =, +, -, @ no início) e só tem letras, números, espaço e
// ' . , ( ) - (bloqueia HTML como <script>). Números ficam: "Maria 2" separa homônimos e o totem grava "(tel. final 22)"
const NOME_REGEX = /^\p{L}[\p{L}\p{M}\p{N}' .,()-]*$/u;
// Parte local começando por letra ou número e só com . _ % + -: nada que vire fórmula (=, +, -, @) ou DDE (| !) se a
// carteira um dia for exportada para planilha
const EMAIL_REGEX = /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

// Nome de cliente a gravar (cadastro, importação, edição e agendamento): mensagem do erro ou null se válido
export const erroNomeCliente = (nome: string): string | null => {
  if (nome.length < 2 || nome.length > LIMITE_NOME_CLIENTE) return `Nome deve ter de 2 a ${LIMITE_NOME_CLIENTE} caracteres.`;
  if (!NOME_REGEX.test(nome)) return 'O nome deve começar com uma letra e ter só letras, números, espaços e os sinais \' . , ( ) -';
  return null;
};

export const emailValido = (email: unknown) => typeof email === 'string' && email.length <= LIMITE_EMAIL && EMAIL_REGEX.test(email);

export type DadosCliente = { nome: string; telefone: string | null; cpf: string | null; email: string | null };
export type ErroCampo = { campo: keyof DadosCliente; mensagem: string };

// Limpa e valida um cliente. Telefone, CPF e e-mail são opcionais; vazio vira null
export const lerCliente = (entrada: Record<string, unknown>): { dados: DadosCliente; erros: ErroCampo[] } => {
  const nome = limparTexto(entrada.nome);
  const telefone = limparTexto(entrada.telefone);
  const cpf = limparTexto(entrada.cpf);
  const email = limparTexto(entrada.email).toLowerCase();
  const erros: ErroCampo[] = [];

  const erroNome = erroNomeCliente(nome);
  if (erroNome) erros.push({ campo: 'nome', mensagem: erroNome });
  if (telefone && !telefoneValido(telefone)) erros.push({ campo: 'telefone', mensagem: MENSAGEM_TELEFONE_INVALIDO });
  if (cpf && !cpfValido(cpf)) erros.push({ campo: 'cpf', mensagem: MENSAGEM_CPF_INVALIDO });
  if (email && !emailValido(email)) erros.push({ campo: 'email', mensagem: MENSAGEM_EMAIL_INVALIDO });

  return {
    dados: { nome, telefone: telefone ? normalizarTelefone(telefone) : null, cpf: cpf ? apenasDigitos(cpf) : null, email: email || null },
    erros,
  };
};

export interface ErroLinha { linha: number; mensagem: string }

/**
 * Valida as linhas de uma planilha (linha 2 = primeira depois do cabeçalho). Linhas em branco são puladas. Duplicado é erro: nome ou CPF repetido
 * dentro da planilha ou já cadastrado (`existentes`, só cadastros ativos).
 */
export const validarImportacao = (
  linhas: Record<string, unknown>[],
  existentes: { nome: string; cpf: string | null; codigo?: number }[],
): { validos: DadosCliente[]; erros: ErroLinha[]; ignoradas: number } => {
  const nomesBase = new Map(existentes.map((c) => [normalizarNome(c.nome), c]));
  const cpfsBase = new Map(existentes.filter((c) => c.cpf).map((c) => [apenasDigitos(c.cpf), c]));
  const nomesPlanilha = new Map<string, number>();
  const cpfsPlanilha = new Map<string, number>();
  const validos: DadosCliente[] = [];
  const erros: ErroLinha[] = [];
  let ignoradas = 0;

  linhas.forEach((entrada, i) => {
    const linha = i + 2;
    // Linha toda em branco no meio da planilha não é cliente nem erro: é pulada (a numeração das outras continua)
    if (Object.values(entrada).every((v) => limparTexto(v) === '')) {
      ignoradas += 1;
      return;
    }
    const { dados, erros: errosCampo } = lerCliente(entrada);
    const mensagens = errosCampo.map((e) => e.mensagem);
    const nome = normalizarNome(dados.nome);

    if (nome && nomesBase.has(nome)) mensagens.push(`Já existe cliente chamado "${nomesBase.get(nome)!.nome}" na base.`);
    else if (nome && nomesPlanilha.has(nome)) mensagens.push(`Nome repetido na planilha (linha ${nomesPlanilha.get(nome)}).`);
    if (dados.cpf && cpfsBase.has(dados.cpf)) mensagens.push(`CPF já cadastrado para "${cpfsBase.get(dados.cpf)!.nome}".`);
    else if (dados.cpf && cpfsPlanilha.has(dados.cpf)) mensagens.push(`CPF repetido na planilha (linha ${cpfsPlanilha.get(dados.cpf)}).`);

    if (nome && !nomesPlanilha.has(nome)) nomesPlanilha.set(nome, linha);
    if (dados.cpf && !cpfsPlanilha.has(dados.cpf)) cpfsPlanilha.set(dados.cpf, linha);

    if (mensagens.length) erros.push(...mensagens.map((mensagem) => ({ linha, mensagem })));
    else validos.push(dados);
  });

  return { validos, erros, ignoradas };
};
