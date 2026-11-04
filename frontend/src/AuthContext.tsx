import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { CODIGO_CONFERINDO, CODIGO_DESAFIO_NECESSARIO } from '@shared/codigosErro';
import { Employee } from './types';
import { getApiUrl } from './config/api';
import { resolverDesafio, type DesafioLogin } from '@shared/provaDeTrabalho';
import { SESSAO_COOKIE, SESSAO_EXPIRADA_EVENT, SESSAO_TROCADA_EVENT, TROCAR_SENHA_EVENT, cabecalhoCsrf, carregarTokenCsrf, definirTokenCsrf, definirUsuarioDaSessao, ehDaSessaoAtual, iniciarNovaSessao } from './api';
import { existeRascunho, limparRascunhos } from './hooks/useFormDraft';

// Formato antigo: o token ficava no localStorage. Agora a sessão vive num cookie HttpOnly (o JS não lê o token)
const TOKEN_STORAGE_KEY_ANTIGO = 'spa_token';
const USER_STORAGE_KEY = 'spa_user';
const SESSION_STORAGE_KEY = 'spa_session_meta';

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const SESSION_INACTIVITY_MS = 15 * 60 * 1000;
const SESSION_CHECK_INTERVAL_MS = 60 * 1000;
const ACTIVITY_THROTTLE_MS = 15 * 1000;

interface SessionMeta {
  issuedAt: number;
  lastActivityAt: number;
  absoluteExpiresAt: number;
  inactivityExpiresAt: number;
  tokenExpiresAt: number | null;
}

interface InitialAuthState {
  currentUser: Employee | null;
  token: string | null;
}

// Dono dos rascunhos guardados: na expiração eles são mantidos, mas só voltam para o mesmo usuário
const RASCUNHO_DONO_KEY = 'rascunho-dono';

const clearStoredAuth = ({ manterRascunhos = false } = {}) => {
  localStorage.removeItem(TOKEN_STORAGE_KEY_ANTIGO);
  localStorage.removeItem(USER_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
  if (!manterRascunhos) {
    limparRascunhos();
    try { sessionStorage.removeItem(RASCUNHO_DONO_KEY); } catch { /* noop */ }
  }
};

const MENSAGEM_SESSAO_EXPIRADA = 'Sua sessão expirou. Faça login novamente.';
// Novo agendamento e edição guardam rascunho; ele volta ao abrir de novo o mesmo horário ou o mesmo agendamento
const MENSAGEM_RASCUNHO_GUARDADO = ' O que você estava preenchendo foi guardado: abra de novo o mesmo agendamento ou horário para continuar.';

const registrarDonoRascunhos = (usuarioId: string) => {
  try {
    sessionStorage.setItem(RASCUNHO_DONO_KEY, usuarioId);
  } catch {
    // noop
  }
};


const parseStoredSessionMeta = (): SessionMeta | null => {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SessionMeta> | null;
    if (!parsed || typeof parsed !== 'object') return null;

    const issuedAt = Number(parsed.issuedAt);
    const lastActivityAt = Number(parsed.lastActivityAt);
    const absoluteExpiresAt = Number(parsed.absoluteExpiresAt);
    const inactivityExpiresAt = Number(parsed.inactivityExpiresAt);
    const tokenExpiresAt = parsed.tokenExpiresAt === null || parsed.tokenExpiresAt === undefined
      ? null
      : Number(parsed.tokenExpiresAt);

    if (!Number.isFinite(issuedAt) || !Number.isFinite(lastActivityAt)) return null;
    if (!Number.isFinite(absoluteExpiresAt) || !Number.isFinite(inactivityExpiresAt)) return null;
    if (tokenExpiresAt !== null && !Number.isFinite(tokenExpiresAt)) return null;

    return {
      issuedAt,
      lastActivityAt,
      absoluteExpiresAt,
      inactivityExpiresAt,
      tokenExpiresAt,
    };
  } catch {
    return null;
  }
};

const persistSessionMeta = (meta: SessionMeta) => {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(meta));
};

const isSessionExpired = (meta: SessionMeta, now: number): boolean => {
  const absoluteExpired = now >= meta.absoluteExpiresAt;
  const inactivityExpired = now >= meta.inactivityExpiresAt;
  const tokenExpired = typeof meta.tokenExpiresAt === 'number' ? now >= meta.tokenExpiresAt : false;
  return absoluteExpired || inactivityExpired || tokenExpired;
};

// tokenExpiresAt vem do login (expiraEm): o navegador não enxerga o token para ler a validade dele
const buildSessionMeta = (tokenExpiresAt: number | null, now: number = Date.now()): SessionMeta => {
  const absoluteCap = now + SESSION_MAX_AGE_MS;
  const absoluteExpiresAt = typeof tokenExpiresAt === 'number'
    ? Math.min(absoluteCap, tokenExpiresAt)
    : absoluteCap;

  const inactivityExpiresAt = Math.min(now + SESSION_INACTIVITY_MS, absoluteExpiresAt);

  return {
    issuedAt: now,
    lastActivityAt: now,
    absoluteExpiresAt,
    inactivityExpiresAt,
    tokenExpiresAt,
  };
};

const touchSession = (now: number = Date.now()): boolean => {
  const currentMeta = parseStoredSessionMeta();
  if (!currentMeta) return false;

  if (isSessionExpired(currentMeta, now)) {
    return false;
  }

  const tokenLimit = typeof currentMeta.tokenExpiresAt === 'number' ? currentMeta.tokenExpiresAt : Number.POSITIVE_INFINITY;
  const inactivityExpiresAt = Math.min(now + SESSION_INACTIVITY_MS, currentMeta.absoluteExpiresAt, tokenLimit);

  persistSessionMeta({
    ...currentMeta,
    lastActivityAt: now,
    inactivityExpiresAt,
  });

  return true;
};

const parseStoredUser = (): Employee | null => {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const role = parsed.role === 'admin'
      ? 'admin'
      : parsed.role === 'supervisor'
      ? 'supervisor'
      : parsed.role === 'receptionist'
      ? 'receptionist'
      : parsed.role === 'collaborator'
      ? 'collaborator'
      : null;
    if (!role || !parsed.id) return null;

    return {
      id: String(parsed.id),
      name: typeof parsed.name === 'string' ? parsed.name : 'Usuário',
      email: typeof parsed.email === 'string' ? parsed.email : '',
      role,
      specialty: typeof parsed.specialty === 'string' ? parsed.specialty : '',
      avatar: typeof parsed.avatar === 'string'
        ? parsed.avatar
        : `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(typeof parsed.name === 'string' ? parsed.name : 'usuario')}`,
      rating: typeof parsed.rating === 'number' ? parsed.rating : 5,
      completedServices: typeof parsed.completedServices === 'number' ? parsed.completedServices : 0,
      diasTrabalho: typeof parsed.diasTrabalho === 'string' ? parsed.diasTrabalho : '1,2,3,4,5,6',
      bloqueios: Array.isArray(parsed.bloqueios) ? parsed.bloqueios : [],
      cargo: typeof parsed.cargo === 'string' ? parsed.cargo : undefined,
      tipoEscala: typeof parsed.tipoEscala === 'string' ? parsed.tipoEscala : undefined,
      folgasDomingoNoMes: typeof parsed.folgasDomingoNoMes === 'number' ? parsed.folgasDomingoNoMes : undefined,
      cargaHorariaSemanal: typeof parsed.cargaHorariaSemanal === 'number' ? parsed.cargaHorariaSemanal : undefined,
      habilidades: Array.isArray(parsed.habilidades) ? parsed.habilidades : undefined,
    };
  } catch {
    return null;
  }
};


// Revoga a sessão no servidor (o token e o cookie HttpOnly): apagar o localStorage não basta, o cookie
// continuaria valendo até expirar para quem usasse o mesmo navegador. Falha de rede não impede sair.
// O login espera o logout em andamento: senão a resposta dele (que apaga o cookie) poderia chegar depois e
// derrubar a sessão nova.
let logoutPendente: Promise<unknown> = Promise.resolve();
const revogarSessaoNoServidor = () => {
  logoutPendente = (async () => {
    // Página recém-aberta (sessão vencida na hidratação) ainda não tem o token anti-CSRF: busca antes
    if (!Object.keys(cabecalhoCsrf()).length) await carregarTokenCsrf();
    await fetch(`${getApiUrl()}/logout`, { method: 'POST', credentials: 'include', headers: cabecalhoCsrf(), keepalive: true });
    definirTokenCsrf(null);
  })().catch(() => {});
};

const hydrateInitialAuthState = (): InitialAuthState => {
  // Sessões do formato antigo (token no localStorage) são descartadas: o próximo login usa o cookie
  if (localStorage.getItem(TOKEN_STORAGE_KEY_ANTIGO)) {
    clearStoredAuth({ manterRascunhos: true });
    return { currentUser: null, token: null };
  }

  const now = Date.now();
  const activeMeta = parseStoredSessionMeta();
  if (!activeMeta || isSessionExpired(activeMeta, now)) {
    if (activeMeta) revogarSessaoNoServidor();
    clearStoredAuth({ manterRascunhos: true });
    return { currentUser: null, token: null };
  }

  persistSessionMeta(activeMeta);

  const currentUser = parseStoredUser();
  if (!currentUser) {
    clearStoredAuth();
    return { currentUser: null, token: null };
  }

  // Aba aberta já logada (sem passar pelo formulário de login) também registra o dono dos rascunhos
  try {
    const dono = sessionStorage.getItem(RASCUNHO_DONO_KEY);
    if (dono && dono !== currentUser.id) limparRascunhos();
  } catch {
    // noop
  }
  registrarDonoRascunhos(currentUser.id);

  return {
    currentUser,
    // Marcador de "logado": o token de verdade está no cookie HttpOnly, enviado pelo navegador
    token: SESSAO_COOKIE,
  };
};

// site: campo-isca do formulário (pessoas deixam vazio); aoVerificarRobo: avisa a tela enquanto a prova de trabalho roda
export type OpcoesLogin = { site?: string; aoVerificarRobo?: (verificando: boolean) => void };

interface AuthContextType {
  currentUser: Employee | null;
  token: string | null;
  loginError: string | null;
  handleLogin: (email: string, pass: string, opcoes?: OpcoesLogin) => Promise<void>;
  handleLogout: () => void;
  // Resposta de POST /minha-senha: sessão nova, sem a marca de senha provisória
  concluirTrocaDeSenha: (resposta: RespostaTrocaSenha) => void;
}

// Resposta de POST /minha-senha que importa aqui: a sessão nova
type RespostaTrocaSenha = { expiraEm?: number; csrf?: string };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialAuthRef = useRef<InitialAuthState | null>(null);
  if (initialAuthRef.current === null) {
    initialAuthRef.current = hydrateInitialAuthState();
  }

  const [currentUser, setCurrentUser] = useState<Employee | null>(initialAuthRef.current.currentUser);
  const [token, setToken] = useState<string | null>(initialAuthRef.current.token);
  const [loginError, setLoginError] = useState<string | null>(null);
  const lastActivityRef = useRef(0);

  const handleLogin = useCallback(async (email: string, pass: string, opcoes: OpcoesLogin = {}) => {
    try {
      await logoutPendente;
      const enviarUmaVez = (desafio?: { id: string; nonce: string }) => fetch(`${getApiUrl()}/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha: pass, campo_controle: opcoes.site, ...(desafio ? { desafio } : {}) }),
      });
      // Outra senha desta conta estava sendo conferida (dura menos de 1 s): tenta de novo sozinho, sem a pessoa ver
      const enviar = async (desafio?: { id: string; nonce: string }) => {
        let resposta = await enviarUmaVez(desafio);
        for (let rodada = 0; rodada < 3 && resposta.status === 429; rodada += 1) {
          if ((await resposta.clone().json().catch(() => null))?.code !== CODIGO_CONFERINDO) break;
          await new Promise((resolver) => setTimeout(resolver, 700 + Math.random() * 600));
          resposta = await enviarUmaVez(desafio);
        }
        return resposta;
      };
      let response = await enviar();
      // Modo de segurança (muitas tentativas): resolve a prova de trabalho e tenta de novo, sem a pessoa fazer nada
      for (let rodada = 0; rodada < 2 && response.status === 401; rodada += 1) {
        const corpo = await response.clone().json().catch(() => null);
        if (corpo?.code !== CODIGO_DESAFIO_NECESSARIO || !corpo.desafio) break;
        opcoes.aoVerificarRobo?.(true);
        try {
          const nonce = await resolverDesafio(corpo.desafio as DesafioLogin);
          response = await enviar({ id: corpo.desafio.id, nonce });
        } finally {
          opcoes.aoVerificarRobo?.(false);
        }
      }

      if (!response.ok) {
        const erro = await response.json().catch(() => null);
        // Prova vencida no caminho (aba em segundo plano): a mensagem do servidor parece algo ainda em andamento
        if (erro?.code === CODIGO_DESAFIO_NECESSARIO) throw new Error('A verificação demorou demais. Digite a senha e clique em Entrar de novo.');
        throw new Error(erro?.erro || 'E-mail ou senha incorretos.');
      }

      const data = await response.json();
      iniciarNovaSessao();
      definirTokenCsrf(data.csrf);
      
      // O servidor gravou o cookie de sessão; aqui fica só a validade, para avisar a expiração na hora
      setToken(SESSAO_COOKIE);
      persistSessionMeta(buildSessionMeta(typeof data.expiraEm === 'number' ? data.expiraEm : null));
      
      const loggedUser: Employee = {
        id: String(data.usuario.id),
        name: data.usuario.nome || 'Usuário',
        email: data.usuario.email || email,
        role: (['admin', 'supervisor', 'receptionist'].includes(data.usuario.papel) ? data.usuario.papel : 'collaborator'),
        specialty: data.usuario.especialidade,
        avatar: `https://api.dicebear.com/7.x/notionists/svg?seed=${data.usuario.nome || 'usuario'}`,
        rating: 5.0,
        completedServices: 0,
        diasTrabalho: data.usuario.diasTrabalho ?? '1,2,3,4,5,6',
        bloqueios: [],
        trocarSenha: data.usuario.trocarSenha === true,
      };
      
      try {
        // Rascunhos de outro usuário (sessão expirada em computador compartilhado) são descartados
        // Sem dono registrado (cadastro anterior a esta regra) o rascunho é tratado como de outra pessoa
        if (sessionStorage.getItem(RASCUNHO_DONO_KEY) !== loggedUser.id) limparRascunhos();
        registrarDonoRascunhos(loggedUser.id);
      } catch {
        // noop
      }
      setCurrentUser(loggedUser);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(loggedUser));
      setLoginError(null);
    } catch (err) {
      setLoginError(err instanceof Error && err.message && !/fetch/i.test(err.message)
        ? err.message
        : 'Não foi possível conectar ao servidor. Tente novamente.');
    }
  }, []);

  const handleLogout = useCallback(() => {
    revogarSessaoNoServidor();
    setCurrentUser(null);
    setToken(null);
    setLoginError(null);
    clearStoredAuth();
  }, []);

  // Expiração (401, inatividade ou limite da sessão): volta ao login com aviso e preserva os rascunhos
  const encerrarSessaoExpirada = useCallback(() => {
    // Inatividade num computador compartilhado: o próximo a usar não pode herdar a sessão pelo cookie
    revogarSessaoNoServidor();
    setCurrentUser(null);
    setToken(null);
    clearStoredAuth({ manterRascunhos: true });
    setLoginError(MENSAGEM_SESSAO_EXPIRADA + (existeRascunho() ? MENSAGEM_RASCUNHO_GUARDADO : ''));
  }, []);

  // Outra conta entrou neste navegador: a tela desta aba fecha sem gravar nada e sem derrubar a sessão nova
  const encerrarPorTrocaDeConta = useCallback(() => {
    definirTokenCsrf(null);
    definirUsuarioDaSessao(null);
    setCurrentUser(null);
    setToken(null);
    setLoginError('Outra conta entrou neste navegador (em outra aba). Esta tela foi fechada sem gravar nada: entre de novo para continuar.');
  }, []);
  useEffect(() => {
    window.addEventListener(SESSAO_TROCADA_EVENT, encerrarPorTrocaDeConta);
    return () => window.removeEventListener(SESSAO_TROCADA_EVENT, encerrarPorTrocaDeConta);
  }, [encerrarPorTrocaDeConta]);

  // Senha provisória: marcada no login, ou descoberta quando a API recusa com TROCAR_SENHA (ex.: supervisão
  // redefiniu a senha enquanto a pessoa estava logada em outro aparelho)
  const marcarTrocaDeSenha = useCallback((trocarSenha: boolean) => {
    setCurrentUser((atual) => {
      if (!atual || Boolean(atual.trocarSenha) === trocarSenha) return atual;
      const proximo = { ...atual, trocarSenha };
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(proximo));
      return proximo;
    });
  }, []);
  useEffect(() => {
    const aoExigirTroca = () => marcarTrocaDeSenha(true);
    window.addEventListener(TROCAR_SENHA_EVENT, aoExigirTroca);
    return () => window.removeEventListener(TROCAR_SENHA_EVENT, aoExigirTroca);
  }, [marcarTrocaDeSenha]);
  const concluirTrocaDeSenha = useCallback((resposta: RespostaTrocaSenha) => {
    iniciarNovaSessao();
    definirTokenCsrf(resposta.csrf);
    persistSessionMeta(buildSessionMeta(typeof resposta.expiraEm === 'number' ? resposta.expiraEm : null));
    marcarTrocaDeSenha(false);
  }, [marcarTrocaDeSenha]);
  // Quem esta aba mostra: a api.ts confere o dono do cookie antes de repetir uma escrita
  const currentUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null;
    definirUsuarioDaSessao(currentUser?.id ?? null);
  }, [currentUser]);

  // Qualquer resposta 401 da API (token expirado/inválido) volta para a tela de login com aviso
  useEffect(() => {
    const onSessaoExpirada = (event: Event) => {
      // 401 de um pedido da sessão anterior: ignorado (ver iniciarNovaSessao)
      if (!ehDaSessaoAtual((event as CustomEvent<{ geracao?: number }>).detail?.geracao)) return;
      encerrarSessaoExpirada();
    };
    window.addEventListener(SESSAO_EXPIRADA_EVENT, onSessaoExpirada);
    return () => window.removeEventListener(SESSAO_EXPIRADA_EVENT, onSessaoExpirada);
  }, [encerrarSessaoExpirada]);

  useEffect(() => {
    if (!token) return;

    if (!touchSession(Date.now())) {
      encerrarSessaoExpirada();
      return;
    }

    const checkSessionExpiry = () => {
      const now = Date.now();
      const meta = parseStoredSessionMeta();

      if (!meta) {
        encerrarSessaoExpirada();
        return;
      }

      if (isSessionExpired(meta, now)) {
        encerrarSessaoExpirada();
      }
    };

    const registerActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;

      lastActivityRef.current = now;
      touchSession(now);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkSessionExpiry();
        registerActivity();
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      // Logout em outra aba apaga o usuário guardado: esta aba sai junto
      if (event.key === USER_STORAGE_KEY && !event.newValue) {
        handleLogout();
        return;
      }
      // Outra conta entrou em outra aba (o cookie agora é dela): esta aba fecha sem revogar a sessão nova
      if (event.key === USER_STORAGE_KEY && event.newValue && currentUserIdRef.current) {
        try {
          const outro = JSON.parse(event.newValue) as { id?: unknown; trocarSenha?: unknown };
          if (String(outro.id) !== currentUserIdRef.current) encerrarPorTrocaDeConta();
          // A mesma pessoa criou a senha em outra aba: esta sai da tela de troca (o cookie novo já vale aqui; o token
          // anti-CSRF era da sessão antiga e é buscado de novo na próxima escrita)
          else if (outro.trocarSenha !== true && event.oldValue && (JSON.parse(event.oldValue) as { trocarSenha?: unknown }).trocarSenha === true) {
            iniciarNovaSessao();
            definirTokenCsrf(null);
            marcarTrocaDeSenha(false);
          }
        } catch {
          encerrarPorTrocaDeConta();
        }
        return;
      }

      if (event.key === SESSION_STORAGE_KEY) {
        checkSessionExpiry();
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = ['click', 'keydown', 'touchstart'];
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, registerActivity, { passive: true });
    }

    window.addEventListener('focus', registerActivity);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('storage', handleStorageChange);

    const interval = window.setInterval(checkSessionExpiry, SESSION_CHECK_INTERVAL_MS);

    return () => {
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, registerActivity);
      }

      window.removeEventListener('focus', registerActivity);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('storage', handleStorageChange);
      window.clearInterval(interval);
    };
  }, [token, handleLogout, encerrarSessaoExpirada, encerrarPorTrocaDeConta, marcarTrocaDeSenha]);

  return (
    // Com senha provisória o token não é entregue às telas: nenhuma lista é buscada até a troca
    <AuthContext.Provider value={{ currentUser, token: currentUser?.trocarSenha ? null : token, loginError, handleLogin, handleLogout, concluirTrocaDeSenha }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook customizado para facilitar o uso nos componentes
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
}