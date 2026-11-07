// Termos de Uso e Política de Privacidade (LGPD). Texto como dados, separado da tela: quem atualiza mexe só aqui
// e troca ATUALIZACAO junto. Os dados da empresa vêm da configuração (nome, contato, endereço).

export type DocumentoLegal = 'termos' | 'privacidade';

export const TITULOS: Record<DocumentoLegal, string> = {
  termos: 'Termos de Uso',
  privacidade: 'Política de Privacidade',
};

export const ATUALIZACAO = 'novembro de 2026';

export type Secao = { titulo: string; texto?: string[]; itens?: string[] };

export interface DadosEmpresa {
  nome: string;
  contato: string;
  endereco?: string;
}

export const termos = ({ nome, contato }: DadosEmpresa): Secao[] => [
  {
    titulo: '1. Objeto',
    texto: [`Este sistema é usado exclusivamente na gestão de ${nome}:`],
    itens: [
      'agendamento e controle dos horários de atendimento;',
      'cadastro de clientes e fichas de anamnese;',
      'catálogo de serviços e regras de atendimento;',
      'escalas, turnos e folgas da equipe;',
      'totem de autoatendimento, em que o próprio cliente agenda e preenche seus dados.',
    ],
  },
  {
    titulo: '2. Acesso e credenciais',
    texto: [
      'O acesso da equipe é feito com usuário de acesso (ou e-mail, quando cadastrado) e senha, pessoais e intransferíveis. A senha provisória entregue no cadastro precisa ser trocada no primeiro acesso.',
      'Cada pessoa vê apenas o que a sua função permite:',
    ],
    itens: [
      'Colaborador: a própria agenda e escala e, nos atendimentos dele, a ficha de anamnese do cliente;',
      'Recepção: agenda de todos os profissionais e cadastro de clientes;',
      'Supervisor: rotinas operacionais, relatórios, equipe e folgas;',
      'Administrador: todas as configurações, inclusive a criação de supervisores.',
    ],
  },
  {
    titulo: '3. Compromissos de quem usa',
    itens: [
      'não compartilhar usuário e senha e avisar a administração ao suspeitar de acesso indevido;',
      'cadastrar dados verdadeiros e, na importação de planilhas, usar apenas bases obtidas de forma lícita;',
      'quando a empresa exigir a ficha de anamnese, conferir que ela está preenchida antes do atendimento.',
    ],
  },
  {
    titulo: '4. Sigilo',
    texto: [
      'Os dados de clientes, sobretudo as informações de saúde das fichas de anamnese, são confidenciais. É proibido copiar, fotografar, exportar ou divulgar esses dados ou relatórios internos para fins alheios às atividades da empresa, sob pena de responsabilização civil, trabalhista e criminal.',
      'Os acessos às fichas ficam registrados (quem abriu, quando) e podem ser auditados.',
    ],
  },
  {
    titulo: '5. Propriedade intelectual',
    texto: [`O software é licenciado para uso de ${nome}. Código, estrutura e layout são protegidos pela legislação de software e de direitos autorais (Leis 9.609/1998 e 9.610/1998).`],
  },
  {
    titulo: '6. Alterações e contato',
    texto: [`Estes Termos podem ser atualizados para refletir melhorias no sistema ou mudanças legais; a data no topo indica a versão em vigor. Dúvidas: ${contato}.`],
  },
];

export const privacidade = ({ nome, contato, endereco }: DadosEmpresa): Secao[] => [
  {
    titulo: '1. Quem trata os seus dados',
    texto: [
      `${nome} é a controladora dos dados pessoais tratados neste sistema, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD).`,
      `Canal do titular (pedidos sobre seus dados): ${contato}${endereco ? `, ou presencialmente em ${endereco}` : ''}.`,
    ],
  },
  {
    titulo: '2. Dados que coletamos',
    itens: [
      'Clientes: nome, telefone/WhatsApp, CPF e e-mail (opcionais) e histórico de agendamentos;',
      'Ficha de anamnese (dado sensível de saúde): alergias, medicamentos, condições de saúde, gestação, cirurgias recentes, restrições e preferências necessárias para a segurança do procedimento;',
      'Equipe: nome, usuário de acesso, e-mail (opcional), cargo, escala, turnos, folgas e registros de acesso ao sistema.',
    ],
  },
  {
    titulo: '3. Para que usamos e com que base legal',
    itens: [
      'Agendar, confirmar e realizar atendimentos e manter o cadastro: execução de contrato (art. 7º, V);',
      'Gerir escalas, jornada e folgas da equipe: obrigação legal trabalhista e execução do contrato de trabalho (art. 7º, II e V);',
      'Ficha de anamnese: consentimento específico e destacado do cliente (art. 11, I), registrado com data e versão do termo aceito. Os dados servem só para avaliar se o procedimento é seguro para a pessoa;',
      'Registros de acesso e auditoria: segurança e exercício regular de direitos (art. 7º, VI e IX).',
    ],
  },
  {
    titulo: '4. Coleta por importação de planilhas',
    texto: ['Dados de controles anteriores da própria empresa podem ser importados ao sistema. A importação confere formatos e evita cadastros duplicados.'],
  },
  {
    titulo: '5. Com quem compartilhamos',
    texto: [
      'Não vendemos, alugamos nem cedemos dados pessoais para publicidade.',
      'Os dados passam apenas pelos fornecedores necessários para o sistema funcionar, que agem sob nossas instruções: hospedagem dos servidores e do banco de dados, envio de mensagens de confirmação (WhatsApp ou e-mail) e, quando o pagamento antecipado estiver ativo, o processador de pagamento. Também podemos fornecer dados a autoridades quando a lei exigir.',
    ],
  },
  {
    titulo: '6. Quem vê a ficha de anamnese',
    texto: ['A ficha é vista pelo profissional responsável pelo atendimento (a partir da chegada do cliente), pela supervisão e pela administração. A recepção vê apenas se a ficha está pendente, sem o conteúdo. Cada abertura da ficha fica registrada.'],
  },
  {
    titulo: '7. Segurança',
    itens: [
      'senhas guardadas apenas como hash (bcrypt), nunca em texto;',
      'permissões por função (colaborador, recepção, supervisor e administrador);',
      'proteção contra tentativas repetidas de login e sessões que expiram;',
      'trilha de auditoria das alterações e dos acessos às fichas;',
      'validação dos dados recebidos.',
    ],
  },
  {
    titulo: '8. Cookies',
    texto: ['Usamos apenas o cookie necessário para manter a sessão de quem entra no sistema. Não usamos cookies de publicidade nem de rastreamento.'],
  },
  {
    titulo: '9. Por quanto tempo guardamos',
    texto: ['Os dados ficam guardados enquanto houver relação com o titular e, depois, pelo tempo exigido por lei ou necessário para defesa em processos (por exemplo, prazos do Código de Defesa do Consumidor e da legislação trabalhista). Passado esse tempo, são eliminados ou anonimizados.'],
  },
  {
    titulo: '10. Seus direitos (art. 18 da LGPD)',
    texto: [`Pelo canal acima, a qualquer momento, você pode:`],
    itens: [
      'confirmar se tratamos seus dados e acessá-los, inclusive a sua ficha de anamnese;',
      'corrigir dados incompletos, inexatos ou desatualizados;',
      'pedir anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desacordo com a lei;',
      'saber com quem seus dados foram compartilhados;',
      'revogar o consentimento. Sem a ficha de anamnese, quando ela é exigida para a segurança do procedimento, o atendimento pode não ser possível.',
    ],
  },
  {
    titulo: '11. Menores de idade',
    texto: ['Dados de menores de 18 anos são cadastrados com o consentimento de um dos pais ou do responsável legal (art. 14).'],
  },
  {
    titulo: '12. Alterações e reclamações',
    texto: ['Esta Política pode ser atualizada; a data no topo indica a versão em vigor. Se o seu pedido não for atendido, você pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).'],
  },
];
