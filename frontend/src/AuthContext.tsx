import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { Employee, Role } from './types';
import { getApiUrl } from './config/api';
import { CABECALHO_CSRF, SESSAO_COOKIE, SESSAO_EXPIRADA_EVENT } from './api';
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
const revogarSessaoNoServidor = () => {
  fetch(`${getApiUrl()}/logout`, { method: 'POST', credentials: 'include', headers: CABECALHO_CSRF, keepalive: true }).catch(() => {});
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

interface AuthContextType {
  currentUser: Employee | null;
  token: string | null;
  loginError: string | null;
  handleLogin: (email: string, pass: string) => Promise<void>;
  handleLogout: () => void;
}

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

  const handleLogin = useCallback(async (email: string, pass: string) => {
    try {
      const response = await fetch(`${getApiUrl()}/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha: pass })
      });

      if (!response.ok) {
        const erro = await response.json().catch(() => null);
        throw new Error(erro?.erro || 'E-mail ou senha incorretos.');
      }

      const data = await response.json();
      
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
        bloqueios: []
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

  // Qualquer resposta 401 da API (token expirado/inválido) volta para a tela de login com aviso
  useEffect(() => {
    const onSessaoExpirada = () => encerrarSessaoExpirada();
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
  }, [token, handleLogout, encerrarSessaoExpirada]);

  return (
    <AuthContext.Provider value={{ currentUser, token, loginError, handleLogin, handleLogout }}>
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