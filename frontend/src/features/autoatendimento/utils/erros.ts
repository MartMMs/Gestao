// Mensagem de um erro desconhecido, com texto padrão quando não houver
export const mensagemDeErro = (erro: unknown, padrao: string) =>
  erro instanceof Error && erro.message ? erro.message : padrao;
