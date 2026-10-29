import React, { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { Employee, Role } from './types';
import { getApiUrl } from './config/api';
import { SESSAO_EXPIRADA_EVENT } from './api';
import { existeRascunho, limparRascunhos } from './hooks/useFormDraft';

const TOKEN_STORAGE_KEY = 'spa_token';
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
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
  if (!manterRascunhos) {
    limparRascunhos();
    try { sessionStorage.removeItem(RASCUNHO_DONO_KEY); } catch { /* noop */ }
  }
};

const MENSAGEM_SESSAO_EXPIRADA = 'Sua sessão expirou. Faça login novamente.';
// Só o "Novo agendamento" tem rascunho; ele volta ao abrir de novo o mesmo horário e profissional
const MENSAGEM_RASCUNHO_GUARDADO = ' O novo agendamento que você estava preenchendo foi guardado: abra o mesmo horário para continuar.';

const registrarDonoRascunhos = (usuarioId: string) => {
  try {
    sessionStorage.setItem(RASCUNHO_DONO_KEY, usuarioId);
  } catch {
    // noop
  }
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadBase64 + '='.repeat((4 - (payloadBase64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));

    if (!payload || typeof payload !== 'object') return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getTokenExpiresAt = (token: string | null): number | null => {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
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

const buildSessionMeta = (token: string, now: number = Date.now()): SessionMeta => {
  const tokenExpiresAt = getTokenExpiresAt(token);
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

const touchSession = (token: string, now: number = Date.now()): boolean => {
  const currentMeta = parseStoredSessionMeta() ?? buildSessionMeta(token, now);

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

const decodeUserFromToken = (token: string | null): Employee | null => {
  if (!token) return null;

  try {
    const payload = decodeJwtPayload(token);
    if (!payload) return null;

    const id = payload?.id ? String(payload.id) : '';
    if (!id) return null;

    const papel = typeof payload?.papel === 'string' ? payload.papel : '';
    const role: Role = papel === 'admin' || papel === 'supervisor' || papel === 'receptionist' ? papel : 'collaborator';
    const name = role === 'admin' ? 'Administrador' : role === 'supervisor' ? 'Supervisor' : role === 'receptionist' ? 'Recepção' : 'Colaborador';

    return {
      id,
      name,
      email: '',
      role,
      specialty: '',
      avatar: `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(name)}`,
      rating: 5,
      completedServices: 0,
      diasTrabalho: '1,2,3,4,5,6',
      bloqueios: [],
    };
  } catch {
    return null;
  }
};

const hydrateInitialAuthState = (): InitialAuthState => {
  const storedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!storedToken) {
    return { currentUser: null, token: null };
  }

  const now = Date.now();
  const tokenExpiresAt = getTokenExpiresAt(storedToken);
  if (typeof tokenExpiresAt === 'number' && now >= tokenExpiresAt) {
    clearStoredAuth({ manterRascunhos: true });
    return { currentUser: null, token: null };
  }

  const rebuiltMeta = buildSessionMeta(storedToken, now);
  const storedMeta = parseStoredSessionMeta();
  const activeMeta = storedMeta && storedMeta.tokenExpiresAt === rebuiltMeta.tokenExpiresAt
    ? storedMeta
    : rebuiltMeta;

  if (isSessionExpired(activeMeta, now)) {
    clearStoredAuth({ manterRascunhos: true });
    return { currentUser: null, token: null };
  }

  persistSessionMeta(activeMeta);

  const currentUser = parseStoredUser() ?? decodeUserFromToken(storedToken);
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
    token: storedToken,
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha: pass })
      });

      if (!response.ok) {
        const erro = await response.json().catch(() => null);
        throw new Error(erro?.erro || 'E-mail ou senha incorretos.');
      }

      const data = await response.json();
      
      setToken(data.token);
      localStorage.setItem(TOKEN_STORAGE_KEY, data.token); // Mantém logado ao dar F5
      persistSessionMeta(buildSessionMeta(data.token));
      
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
    // Revoga o token no servidor; falha de rede não impede sair
    const tokenAtual = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (tokenAtual) {
      fetch(`${getApiUrl()}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${tokenAtual}` }, keepalive: true }).catch(() => {});
    }
    setCurrentUser(null);
    setToken(null);
    setLoginError(null);
    clearStoredAuth();
  }, []);

  // Expiração (401, inatividade ou limite da sessão): volta ao login com aviso e preserva os rascunhos
  const encerrarSessaoExpirada = useCallback(() => {
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

    if (!touchSession(token, Date.now())) {
      encerrarSessaoExpirada();
      return;
    }

    const checkSessionExpiry = () => {
      const now = Date.now();
      const meta = parseStoredSessionMeta();

      if (!meta) {
        persistSessionMeta(buildSessionMeta(token, now));
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
      touchSession(token, now);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkSessionExpiry();
        registerActivity();
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === TOKEN_STORAGE_KEY && !event.newValue) {
        handleLogout();
        return;
      }

      if (event.key === TOKEN_STORAGE_KEY || event.key === SESSION_STORAGE_KEY) {
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