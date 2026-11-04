import { Router } from 'express';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '../db';
import { config } from '../env';
import { assinarToken, avisoTentativasSenha, dadosDoToken, getUsuario, revogarToken, senhaAtualConfere, tokenCsrfDaSessao, usuarioEhAdmin, verificarSupervisorToken, verificarToken, verificarTokenSenhaProvisoria, violaCsrf, type Papel } from '../auth';
import { redisService } from '../services/redisService';
import { getEmpresaConfig } from '../services/configService';
import { obterFeriadosNacionais } from '../../shared/feriadosBR';
import { responderErro, ipDoCliente } from '../lib/http';
import { registrarAuditoria } from '../lib/auditoria';
import { provaValida, type DesafioLogin } from '../../shared/provaDeTrabalho';
import { CODIGO_CONFERINDO, CODIGO_CSRF, CODIGO_DESAFIO_NECESSARIO, CODIGO_ESPERA } from '../../shared/codigosErro';
import { INVALIDAR_SESSOES, validarSenha } from '../lib/usuarios';
import { apagarCookieSessao, gravarCookieSessao, tokenDaRequisicao } from '../lib/cookies';
import type { Eventos } from '../lib/eventos';

// Bloqueio (429) por janela: por e-mail+IP (quem erra a própria senha) e por IP (força bruta de um ponto).
// O total por e-mail (somando todos os IPs) NÃO tranca a conta: senão qualquer um trancaria a do admin só errando
// a senha dela. Ele liga o modo de segurança e uma espera curta e crescente entre tentativas (esperaPara).
const MAX_TENTATIVAS_EMAIL_IP = 10;
const MAX_TENTATIVAS_IP = config.loginMaxTentativasIp;
const JANELA_LOGIN_SEGUNDOS = 15 * 60;
// Modo de segurança (antes do bloqueio): a partir do 4º erro no mesmo e-mail e aparelho, do 6º no mesmo e-mail
// vindo de qualquer lugar, ou do 21º no mesmo IP,
// o login passa a exigir uma prova de trabalho (shared/provaDeTrabalho.ts). Uma pessoa resolve sem perceber, em
// menos de um segundo; um robô paga esse custo a cada senha testada (16 bits, 17 depois de mais erros).
const ERROS_PARA_MODO_SEGURANCA_EMAIL_IP = 3;
const ERROS_PARA_MODO_SEGURANCA_EMAIL = 5; // de qualquer IP: ataque distribuído contra uma conta
const ERROS_PARA_MODO_SEGURANCA_IP = 20;
const MAX_DESAFIOS_POR_MINUTO_IP = config.loginMaxDesafiosPorMinutoIp; // emitir desafio é barato para quem pede: tem teto próprio
// Somando todos os IPs: no máximo ~4.000 desafios vivos (~1 MB no Redis); uma recepção real fica muito abaixo disso
const MAX_DESAFIOS_POR_MINUTO_TOTAL = 2000;
// Base baixa: medida em Node, 18 bits levavam de 1 a 3 s num computador (muito mais num tablet), e no modo por IP a
// recepção inteira paga isso a cada login. O freio forte contra robôs é a espera por conta, não a prova
const DIFICULDADE_BASE = 16;
// Teto baixo: quem esqueceu a senha não pode ficar dezenas de segundos esperando. O freio contra o robô que troca
// de IP é a espera por conta (abaixo), não a prova
const DIFICULDADE_MAXIMA = 17;
// Espera por conta, somando todos os IPs: a partir do 5º erro, 1 s, 2 s, 4 s... até 60 s entre tentativas daquele
// e-mail. Não tranca a conta (a dona entra depois da espera), mas um ataque distribuído testa no máximo ~1 senha por minuto
const ESPERA_MAXIMA_SEGUNDOS = 60;
const esperaPara = (erros: number) => (erros < ERROS_PARA_MODO_SEGURANCA_EMAIL
  ? 0
  : Math.min(ESPERA_MAXIMA_SEGUNDOS, 2 ** (erros - ERROS_PARA_MODO_SEGURANCA_EMAIL)));
const chaveEspera = (emailHash: string) => `seguranca:login:espera:${emailHash}`;
// Valor da chave de espera enquanto uma senha da conta está sendo conferida (a trava expira sozinha se o processo cair)
const VALOR_TRAVA_CONFERINDO = 'conferindo';
const TRAVA_CONFERENCIA_SEGUNDOS = 10;
// Aparelho (IP) onde esta conta já entrou com a senha certa: não passa pela espera nem pelo teto geral de desafios.
// Sem isso, quem sabe o e-mail manteria a dona esperando para sempre errando a senha a cada fim de espera
const APARELHO_CONHECIDO_SEGUNDOS = 30 * 86_400;
const chaveAparelhoConhecido = (emailHash: string, ip: string) => `seguranca:login:conhecido:${emailHash}:${ip}`;
const VALIDADE_DESAFIO_SEGUNDOS = 120;
const chaveDesafio = (id: string) => `seguranca:login:desafio:${id}`;

const dificuldadePara = (erros: number) =>
  Math.min(DIFICULDADE_MAXIMA, DIFICULDADE_BASE + Math.floor(Math.max(0, erros - ERROS_PARA_MODO_SEGURANCA_EMAIL_IP) / 2));

// Hash do e-mail nas chaves e nos desafios: tamanho fixo e sem o e-mail em texto no Redis
const hashEmail = (email: string) => crypto.createHash('sha256').update(email).digest('hex').slice(0, 32);

// Desafio preso ao IP e ao e-mail: não dá para pedir um desafio fácil com outro e-mail e usar neste
const emitirDesafio = async (ip: string, email: string, erros: number): Promise<DesafioLogin> => {
  const desafio = { id: crypto.randomUUID(), prefixo: crypto.randomBytes(16).toString('hex'), dificuldade: dificuldadePara(erros) };
  await redisService.set(chaveDesafio(desafio.id), JSON.stringify({ prefixo: desafio.prefixo, dificuldade: desafio.dificuldade, ip, email: hashEmail(email) }), VALIDADE_DESAFIO_SEGUNDOS);
  return desafio;
};

// Prova vale uma vez, só para o IP e o e-mail que receberam o desafio e dentro da validade
const provaAceita = async (prova: unknown, ip: string, email: string) => {
  if (!prova || typeof prova !== 'object') return false;
  const { id, nonce } = prova as { id?: unknown; nonce?: unknown };
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || typeof nonce !== 'string') return false;
  const guardado = await redisService.get(chaveDesafio(id));
  if (!guardado) return false;
  // Consumido antes de conferir: a mesma prova não serve para duas tentativas, nem em paralelo
  if (await redisService.deleteKey(chaveDesafio(id)) === 0) return false;
  const desafio = JSON.parse(guardado) as { prefixo: string; dificuldade: number; ip: string; email: string };
  return desafio.ip === ip && desafio.email === hashEmail(email)
    && provaValida(desafio.prefixo, nonce, desafio.dificuldade);
};

// No log só a 1ª letra e o domínio: o texto digitado nunca vai inteiro (pode ser um CPF ou uma senha)
const mascararEmail = (email: string) => (/^.[^@]*@[^@]+$/.test(email) ? email.replace(/^(.).*(@.*)$/, '$1***$2') : '***');
// Nome sem significado: gerenciadores de senha preenchem campos como "site" ou "url" sozinhos
const CAMPO_ISCA = 'campo_controle';

// Hash de uma senha aleatória, usado só para igualar o tempo do login com e-mail inexistente
const HASH_FICTICIO = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

const CAMPOS_EMPRESA = [
  'nomeEmpresa', 'segmento', 'slogan', 'icone', 'termoAtendimento', 'termoProfissional',
  'termoEspaco', 'termoServico', 'telefoneContato', 'emailContato', 'endereco', 'corTemaPrimaria',
] as const;

const validarConfigEmpresa = (body: Record<string, unknown>) => {
  const dados: Record<string, string | boolean | null> = {};
  if (body.usarComissao !== undefined) {
    if (typeof body.usarComissao !== 'boolean') return { erro: 'Campo usarComissao inválido.' };
    dados.usarComissao = body.usarComissao;
  }
  for (const campo of CAMPOS_EMPRESA) {
    const valor = body[campo];
    if (valor === undefined) continue;
    if (valor !== null && typeof valor !== 'string') return { erro: `Campo ${campo} inválido.` };
    const texto = typeof valor === 'string' ? valor.trim() : null;
    if (texto && texto.length > 200) return { erro: `O campo ${campo} deve ter no máximo 200 caracteres.` };
    dados[campo] = texto || null;
  }
  if (dados.nomeEmpresa === null) return { erro: 'O nome da empresa é obrigatório.' };
  if (dados.segmento === null) delete dados.segmento;
  if (typeof dados.corTemaPrimaria === 'string' && !/^#[0-9a-fA-F]{6}$/.test(dados.corTemaPrimaria)) {
    return { erro: 'A cor do tema deve estar no formato #RRGGBB.' };
  }
  if (typeof dados.emailContato === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.emailContato)) {
    return { erro: 'Informe um e-mail de contato válido.' };
  }
  return { dados };
};

export function createEmpresaRouter(eventos: Eventos) {
  const router = Router();

  // Login (público). Mensagem única para e-mail ou senha errados, para não revelar quais e-mails existem.
  router.post('/login', async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
      if (!email || !senha) return res.status(400).json({ erro: 'Informe e-mail e senha.' });
      // Antes de tocar no Redis: um e-mail gigante ou inventado não pode virar chave (o Redis encheria e a API cairia)
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' });
      if (senha.length > 200) return res.status(400).json({ erro: 'E-mail ou senha incorretos.' });

      // Dois tipos de contador:
      // - tentativas (por IP e por e-mail+IP): contadas ANTES de conferir a senha (incremento atômico), só como teto
      //   que bloqueia; acertos são devolvidos;
      // - erros (por e-mail+IP, por e-mail e por IP): contados só DEPOIS que o bcrypt recusa a senha, com janela
      //   deslizante. Decidem o modo de segurança e a espera, e logins certos em paralelo nunca contam como erro.
      // Em aparelho desconhecido, a conta confere UMA senha por vez (trava da conta, abaixo): uma rajada em paralelo
      // não passa toda pelo bcrypt antes de o primeiro erro ser contado.
      const ip = ipDoCliente(req);
      const emailHash = hashEmail(email);
      const chaveEmailIp = `ratelimit:login:email-ip:${emailHash}:${ip}`;
      const chaveIp = `ratelimit:login:ip:${ip}`;
      const chavesErro = {
        emailIp: `seguranca:login:erros:email-ip:${emailHash}:${ip}`,
        email: `seguranca:login:erros:email:${emailHash}`,
        ip: `seguranca:login:erros:ip:${ip}`,
      };
      // Teto por IP primeiro: um IP já bloqueado não cria chaves novas por e-mail (encheria o Redis com e-mails inventados)
      const limiteIp = await redisService.rateLimit(chaveIp, MAX_TENTATIVAS_IP, JANELA_LOGIN_SEGUNDOS);
      const limiteEmailIp = limiteIp.allowed ? await redisService.rateLimit(chaveEmailIp, MAX_TENTATIVAS_EMAIL_IP, JANELA_LOGIN_SEGUNDOS) : limiteIp;
      if (!limiteEmailIp.allowed) {
        return res.status(429).json({ erro: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.' });
      }
      const devolverTentativa = () => Promise.all([redisService.devolverTentativa(chaveEmailIp), redisService.devolverTentativa(chaveIp)]);
      const conhecido = Boolean(await redisService.get(chaveAparelhoConhecido(emailHash, ip)));
      // Recusa por espera NÃO devolve a tentativa: ficar reenviando para pegar a vaga no instante em que a espera
      // acaba gasta as 10 tentativas por e-mail+IP em segundos (prender a dona assim exigiria milhares de IPs)
      const recusarPorEspera = async () => {
        const ttl = await redisService.getTtl(chaveEspera(emailHash));
        const conferindo = (await redisService.get(chaveEspera(emailHash))) === VALOR_TRAVA_CONFERINDO;
        return res.status(429).json({
          // CONFERINDO: dura menos de 1 s, o front tenta de novo sozinho
          code: conferindo ? CODIGO_CONFERINDO : CODIGO_ESPERA,
          erro: conferindo
            ? 'Outra tentativa de entrar nesta conta está sendo conferida. Tente de novo em instantes.'
            : `Muitas tentativas erradas nesta conta. Aguarde ${Math.max(1, ttl)} s, digite a senha e tente novamente.`,
        });
      };
      // Erros já confirmados antes desta tentativa
      const [errosEmailIp, errosEmail, errosIp] = (await Promise.all([chavesErro.emailIp, chavesErro.email, chavesErro.ip]
        .map((chave) => redisService.get(chave)))).map((valor) => Number(valor) || 0);

      // Campo-isca (invisível na tela): só robô que preenche todo campo do formulário chega aqui com ele
      // Isca não gasta a tentativa do e-mail (senão serviria para trancar a conta de outra pessoa), mas conta
      // contra o IP de quem a manda: assim também tem teto (60 por IP)
      if (typeof req.body?.[CAMPO_ISCA] === 'string' && req.body[CAMPO_ISCA].trim()) {
        await redisService.devolverTentativa(chaveEmailIp);
        console.warn('[SEGURANCA] Login com campo-isca preenchido (robô)', { ip, email: mascararEmail(email) });
        return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
      }

      // Conta em espera (ou com outra senha sendo conferida): recusa sem pedir prova nem conferir a senha
      if (!conhecido && await redisService.getTtl(chaveEspera(emailHash)) > 0) return recusarPorEspera();

      const emModoSeguranca = errosEmailIp >= ERROS_PARA_MODO_SEGURANCA_EMAIL_IP
        || errosEmail >= ERROS_PARA_MODO_SEGURANCA_EMAIL
        || errosIp >= ERROS_PARA_MODO_SEGURANCA_IP;
      if (emModoSeguranca) {
        if (!(await provaAceita(req.body?.desafio, ip, email))) {
          // Pedido sem prova não conta como tentativa de senha (a senha nem é conferida)
          await devolverTentativa();
          const desafiosNoMinuto = await redisService.rateLimit(`seguranca:login:desafios:${ip}`, MAX_DESAFIOS_POR_MINUTO_IP, 60);
          // Teto geral: com milhares de IPs, os desafios guardados (120 s cada) encheriam o Redis
          const desafiosGerais = desafiosNoMinuto.allowed && !conhecido
            ? await redisService.rateLimit('seguranca:login:desafios:total', MAX_DESAFIOS_POR_MINUTO_TOTAL, 60)
            : desafiosNoMinuto;
          if (!desafiosGerais.allowed) return res.status(429).json({ erro: 'Muitas tentativas de login. Aguarde um minuto e tente novamente.' });
          if (errosEmailIp === ERROS_PARA_MODO_SEGURANCA_EMAIL_IP || errosEmail === ERROS_PARA_MODO_SEGURANCA_EMAIL || errosIp === ERROS_PARA_MODO_SEGURANCA_IP) {
            console.warn('[SEGURANCA] Modo de segurança do login ativado', { ip, email: mascararEmail(email), errosEmailIp, errosEmail, errosIp });
          }
          return res.status(401).json({
            erro: 'Muitas tentativas: confirmando que você não é um robô.',
            code: CODIGO_DESAFIO_NECESSARIO,
            // A dificuldade cresce só para o e-mail que está errando neste aparelho; o modo ligado pelo IP (que
            // pega todo mundo da mesma rede) fica no nível base, para a recepção não ficar lenta por causa de um robô
            desafio: await emitirDesafio(ip, email, errosEmailIp),
          });
        }
      }

      // Trava da conta (aparelho desconhecido): SET NX atômico antes do bcrypt, solta só depois que o resultado é
      // contado. Quem chega enquanto ela existe recebe 429 sem conferir a senha
      if (!conhecido && !(await redisService.acquireLock(chaveEspera(emailHash), TRAVA_CONFERENCIA_SEGUNDOS, VALOR_TRAVA_CONFERINDO))) {
        return recusarPorEspera();
      }

      const usuario = await prisma.colaborador.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, ativo: true },
        omit: { senha: false, versaoToken: false },
      });

      // Usuário sem senha cadastrada não entra. Sempre roda o bcrypt (com um hash fictício se preciso)
      // para o tempo de resposta não revelar quais e-mails existem.
      const senhaValida = await bcrypt.compare(senha, usuario?.senha || HASH_FICTICIO) && Boolean(usuario?.senha);
      if (!usuario || !senhaValida) {
        // Erro confirmado: conta para o modo de segurança e a espera; a trava vira a espera (ou é solta, se ainda não há)
        await Promise.all(Object.values(chavesErro).map((chave) => redisService.incrementarRenovando(chave, JANELA_LOGIN_SEGUNDOS)));
        if (!conhecido) {
          const segundos = esperaPara(errosEmail + 1);
          if (segundos > 0) await redisService.set(chaveEspera(emailHash), '1', segundos);
          else await redisService.releaseLock(chaveEspera(emailHash), VALOR_TRAVA_CONFERINDO);
        }
        return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
      }
      // Acertou: zera os erros deste e-mail neste aparelho e devolve a tentativa aos tetos (recepções com muitos
      // logins no mesmo IP não são travadas). Este IP passa a ser aparelho conhecido da conta, e a espera acaba
      await Promise.all([
        redisService.set(chaveAparelhoConhecido(emailHash, ip), '1', APARELHO_CONHECIDO_SEGUNDOS),
        redisService.deleteKey(chaveEspera(emailHash)),
        redisService.deleteKey(chavesErro.emailIp),
        redisService.deleteKey(chaveEmailIp),
        redisService.devolverTentativa(chaveIp),
      ]);

      const { senha: _hash, versaoToken: _versao, ...usuarioPublico } = usuario;
      const token = assinarToken({ id: usuario.id, papel: usuario.papel as Papel }, usuario.versaoToken, config.jwtExpiraEmSegundos);
      gravarCookieSessao(res, token);
      const expiraEm = Date.now() + config.jwtExpiraEmSegundos * 1000;
      // O navegador usa só o cookie HttpOnly; o token no corpo é entregue apenas a quem pede (scripts e testes de API)
      const querToken = req.headers['x-auth-mode'] === 'token';
      res.json({ usuario: usuarioPublico, expiraEm, csrf: tokenCsrfDaSessao(token), ...(querToken ? { token } : {}) });
    } catch (error) {
      responderErro(res, error, 'Erro interno no servidor');
    }
  });

  // Troca da própria senha (inclusive a provisória do 1º acesso): exige a atual, derruba as outras sessões e
  // devolve uma sessão nova, para a pessoa seguir sem entrar de novo
  router.post('/minha-senha', verificarTokenSenhaProvisoria, async (req, res) => {
    try {
      const id = getUsuario(req)!.id;
      const senhaAtual = typeof req.body?.senhaAtual === 'string' ? req.body.senhaAtual : '';
      const novaSenha = typeof req.body?.senha === 'string' ? req.body.senha : '';
      const erroSenha = validarSenha(novaSenha);
      if (erroSenha) return res.status(400).json({ erro: erroSenha });
      const conta = await prisma.colaborador.findUnique({ where: { id }, omit: { senha: false } });
      const conferencia = await senhaAtualConfere(id, senhaAtual, conta?.senha);
      if (!conta?.senha || !conferencia.confere) {
        return res.status(403).json({ erro: `Senha atual (ou provisória) incorreta.${avisoTentativasSenha(conferencia.restantes)}` });
      }
      if (await bcrypt.compare(novaSenha, conta.senha)) return res.status(400).json({ erro: 'A nova senha precisa ser diferente da atual.' });

      const atualizado = await prisma.colaborador.update({
        where: { id },
        data: { senha: await bcrypt.hash(novaSenha, 10), trocarSenha: false, ...INVALIDAR_SESSOES },
        omit: { versaoToken: false },
      });
      // A sessão usada aqui (e qualquer outra com a senha antiga) deixa de valer; os sockets dela caem
      const { token: tokenAntigo } = tokenDaRequisicao(req);
      if (tokenAntigo) await revogarToken(tokenAntigo);
      eventos.encerrarSessoesDoUsuario(id);

      const { versaoToken, ...usuarioPublico } = atualizado;
      const token = assinarToken({ id, papel: atualizado.papel as Papel }, versaoToken, config.jwtExpiraEmSegundos);
      gravarCookieSessao(res, token);
      await registrarAuditoria(req, { acao: 'conta.senha', alvo: `Conta de ${atualizado.nome}`, antes: { trocarSenha: conta.trocarSenha }, depois: { trocarSenha: false } });
      res.json({ usuario: usuarioPublico, expiraEm: Date.now() + config.jwtExpiraEmSegundos * 1000, csrf: tokenCsrfDaSessao(token) });
    } catch (error) {
      responderErro(res, error, 'Erro ao trocar a senha.');
    }
  });

  // Token anti-CSRF da sessão atual (a página recarregada não tem mais o da resposta do login). GET: outro site
  // pode disparar, mas não consegue ler a resposta (CORS)
  router.get('/csrf', verificarTokenSenhaProvisoria, (req, res) => {
    const { token } = tokenDaRequisicao(req);
    res.setHeader('Cache-Control', 'no-store');
    // usuarioId: a aba confere se o cookie ainda é de quem ela mostra (outra conta pode ter entrado em outra aba)
    res.json({ csrf: token ? tokenCsrfDaSessao(token) : null, usuarioId: getUsuario(req)?.id ?? null });
  });

  // Logout: o token deixa de valer imediatamente (mesmo que tenha sido copiado)
  router.post('/logout', async (req, res) => {
    try {
      const { token, viaCookie } = tokenDaRequisicao(req);
      // Token que já não vale (vencido ou adulterado): não há sessão a proteger, só apaga o cookie
      if (!token || !dadosDoToken(token)) {
        apagarCookieSessao(res);
        return res.status(204).end();
      }
      // Sem o cabeçalho anti-CSRF, outro site não consegue derrubar a sessão com um formulário
      if (violaCsrf(req, token, viaCookie)) return res.status(403).json({ erro: 'Requisição recusada.', code: CODIGO_CSRF });
      const jti = await revogarToken(token);
      if (jti) eventos.encerrarSessao(jti);
      apagarCookieSessao(res);
      res.status(204).end();
    } catch (error) {
      responderErro(res, error, 'Erro ao encerrar a sessão.');
    }
  });

  router.get('/feriados', verificarToken, (req, res) => {
    const anoQuery = Number(req.query.ano);
    const mesQuery = req.query.mes === undefined ? NaN : Number(req.query.mes);
    const ano = Number.isInteger(anoQuery) && anoQuery >= 2000 && anoQuery <= 2100 ? anoQuery : new Date().getFullYear();

    if (req.query.mes !== undefined && (!Number.isInteger(mesQuery) || mesQuery < 1 || mesQuery > 12)) {
      return res.status(400).json({ erro: 'Parâmetro mês inválido. Use valores entre 1 e 12.' });
    }

    const feriados = obterFeriadosNacionais(ano);
    if (Number.isInteger(mesQuery)) {
      const prefixo = `${ano}-${String(mesQuery).padStart(2, '0')}`;
      return res.json(feriados.filter((f) => f.data.startsWith(prefixo)));
    }
    res.json(feriados);
  });

  // Configurações gerais da empresa (leitura pública: usadas na tela de login e no totem)
  router.get('/empresa/config', async (_req, res) => {
    try {
      res.json(await getEmpresaConfig());
    } catch (error) {
      responderErro(res, error, 'Falha ao buscar configurações da empresa');
    }
  });

  router.put('/empresa/config', verificarSupervisorToken, async (req, res) => {
    try {
      const validacao = validarConfigEmpresa(req.body || {});
      if (!validacao.dados) return res.status(400).json({ erro: validacao.erro });
      // Ligar/desligar comissão muda o líquido dos relatórios: decisão do administrador
      const atual = await getEmpresaConfig();
      if (validacao.dados.usarComissao !== undefined && validacao.dados.usarComissao !== atual.usarComissao && !usuarioEhAdmin(req)) {
        return res.status(403).json({ erro: 'Apenas o administrador pode ligar ou desligar a comissão.' });
      }

      await getEmpresaConfig();
      const configAtualizada = await prisma.configuracaoEmpresa.update({
        where: { id: 'default' },
        data: validacao.dados as Prisma.ConfiguracaoEmpresaUpdateInput,
      });

      await registrarAuditoria(req, { acao: 'empresa.comissao', alvo: 'Comissão da empresa', antes: atual, depois: configAtualizada, campos: ['usarComissao'] });
      eventos.emitirConfigEmpresa(configAtualizada);
      eventos.notificarMudanca();
      res.json(configAtualizada);
    } catch (error) {
      responderErro(res, error, 'Falha ao salvar configurações da empresa');
    }
  });

  return router;
}
