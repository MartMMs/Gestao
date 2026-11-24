// Códigos de erro de sessão que o servidor devolve em `code` e o front trata (renomear aqui muda os dois lados)
export const CODIGO_CSRF = 'CSRF';
export const CODIGO_TROCAR_SENHA = 'TROCAR_SENHA';
// Login: a conta está conferindo outra senha agora (o front repete sozinho) / precisa da prova de trabalho
export const CODIGO_CONFERINDO = 'CONFERINDO';
export const CODIGO_DESAFIO_NECESSARIO = 'DESAFIO_NECESSARIO';
// Login em espera depois de erros seguidos (o front mostra a mensagem, que diz quanto falta)
export const CODIGO_ESPERA = 'ESPERA';
// PUT /empresa/config: o horário novo deixa atendimentos marcados de fora; reenviar com confirmarForaDoHorario
export const CODIGO_FORA_DO_HORARIO = 'FORA_DO_HORARIO';
// PUT /empresa/config: outra pessoa salvou a config depois que esta tela carregou (manda a versao lida em `versao`)
export const CODIGO_CONFIG_DESATUALIZADA = 'CONFIG_DESATUALIZADA';
