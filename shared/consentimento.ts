// Texto do consentimento do totem (LGPD art. 8º §2º e art. 11). A versão é gravada junto com a data em cada
// agendamento: mudou o texto (ou se inclui ou não dados de saúde), muda a versão gravada
export const VERSAO_CONSENTIMENTO_SAUDE = '2026-11-03-saude';
export const VERSAO_CONSENTIMENTO_GERAL = '2026-11-03-geral';

const VERSOES_CONSENTIMENTO_VALIDAS = new Set<string>([
  VERSAO_CONSENTIMENTO_SAUDE,
  VERSAO_CONSENTIMENTO_GERAL,
]);

export const versaoConsentimento = (comSaude: boolean) =>
  (comSaude ? VERSAO_CONSENTIMENTO_SAUDE : VERSAO_CONSENTIMENTO_GERAL);

export const versaoConsentimentoValida = (versao: unknown): versao is string =>
  typeof versao === 'string' && VERSOES_CONSENTIMENTO_VALIDAS.has(versao);

export const textoConsentimento = (nomeEmpresa: string | null | undefined, comSaude: boolean) => ({
  versao: versaoConsentimento(comSaude),
  // Sem as perguntas de saúde ainda há a de alergia (dado de saúde, LGPD art. 11): o texto geral a cita
  autorizacao: `Autorizo ${nomeEmpresa || 'o estabelecimento'} a usar meus dados pessoais e as informações ${comSaude ? 'de saúde acima' : 'acima (inclusive sobre alergias)'} somente para realizar este atendimento e manter meu cadastro.`,
  detalhe: 'As informações acima só ficam visíveis ao profissional depois da sua chegada. Você pode pedir na recepção, a qualquer momento, para ver, corrigir ou apagar seus dados (LGPD).',
});
