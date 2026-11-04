import Redis from 'ioredis';
import { config } from '../env';
import { ServicoIndisponivelError } from '../lib/http';

class InMemoryRedisFallback {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async set(key: string, value: string, mode?: string, ttl?: number, flag?: string): Promise<string | null> {
    const now = Date.now();
    const existing = this.store.get(key);

    if (existing && existing.expiresAt && existing.expiresAt <= now) {
      this.store.delete(key);
    }

    if (flag === 'NX' && this.store.has(key)) {
      return null;
    }

    const expiresAt = mode === 'EX' && typeof ttl === 'number' ? now + ttl * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing) return null;
    if (existing.expiresAt && existing.expiresAt <= now) {
      this.store.delete(key);
      return null;
    }
    return existing.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async ttl(key: string): Promise<number> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing) return -2;
    if (!existing.expiresAt) return -1;
    const remainingMs = existing.expiresAt - now;
    if (remainingMs <= 0) {
      this.store.delete(key);
      return -2;
    }
    return Math.ceil(remainingMs / 1000);
  }

  async eval(script: string, numKeys: number, key: string, arg: string): Promise<number> {
    const current = await this.get(key);
    if (current === arg) {
      await this.del(key);
      return 1;
    }
    return 0;
  }

  async incr(key: string): Promise<number> {
    const current = await this.get(key);
    const next = (Number(current) || 0) + 1;
    const existing = this.store.get(key);
    if (existing) {
      // Preserva o TTL da chave, como o INCR do Redis
      existing.value = String(next);
    } else {
      await this.set(key, String(next));
    }
    return next;
  }

  async decr(key: string): Promise<number> {
    const existing = this.store.get(key);
    if (!existing) return 0;
    const next = Math.max(0, (Number(existing.value) || 0) - 1);
    existing.value = String(next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const existing = this.store.get(key);
    if (!existing) return 0;
    existing.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }
}

class RedisManager {
  private client: Redis | null = null;
  private memoria = new InMemoryRedisFallback();
  private isConnected = false;
  // Fora de produção (uma instância, desenvolvimento) a memória local substitui o Redis
  private readonly permiteMemoria = !config.producao;

  // Redis indisponível: em desenvolvimento usa a memória local; em produção falha fechado (503)
  private memoriaOuFalha() {
    if (!this.permiteMemoria) throw new ServicoIndisponivelError();
    return this.memoria;
  }

  constructor() {
    this.init();
  }

  private init() {
    const redisUrl = config.redisUrl;
    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        connectTimeout: 2000,
        // Em produção tenta reconectar para sempre; em desenvolvimento desiste e usa a memória
        retryStrategy: (times) => {
          if (times > 3 && this.permiteMemoria) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: false,
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('[REDIS] Conectado ao servidor Redis com sucesso.');
      });

      this.client.on('error', (err) => {
        if (this.isConnected) {
          console.warn(`[REDIS] Erro na conexão${this.permiteMemoria ? ', alternando para fallback em memória' : ''}:`, err.message);
        }
        this.isConnected = false;
      });
      this.client.on('close', () => {
        if (this.isConnected) console.warn('[REDIS] Conexão encerrada.');
        this.isConnected = false;
      });
    } catch (err: unknown) {
      console.warn('[REDIS] Falha ao instanciar cliente, usando fallback em memória:', err instanceof Error ? err.message : err);
      this.isConnected = false;
    }
  }

  async acquireLock(key: string, ttlSeconds: number, lockId: string): Promise<boolean> {
    try {
      if (this.isConnected && this.client) {
        const result = await this.client.set(key, lockId, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      }
    } catch {
      // Fallback
    }
    const result = await this.memoriaOuFalha().set(key, lockId, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string, lockId: string): Promise<boolean> {
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      if (this.isConnected && this.client) {
        const res = await this.client.eval(luaScript, 1, key, lockId);
        return res === 1;
      }
    } catch {
      // Fallback
    }
    const res = await this.memoriaOuFalha().eval(luaScript, 1, key, lockId);
    return res === 1;
  }

  async setSession(key: string, data: unknown, ttlSeconds = 600): Promise<void> {
    const value = JSON.stringify(data);
    try {
      if (this.isConnected && this.client) {
        await this.client.set(key, value, 'EX', ttlSeconds);
        return;
      }
    } catch {
      // Fallback
    }
    await this.memoriaOuFalha().set(key, value, 'EX', ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    try {
      if (this.isConnected && this.client) {
        return await this.client.get(key);
      }
    } catch {
      // Fallback
    }
    return await this.memoriaOuFalha().get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (this.isConnected && this.client) {
        if (typeof ttlSeconds === 'number') {
          await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, value);
        }
        return;
      }
    } catch {
      // Fallback
    }
    if (typeof ttlSeconds === 'number') {
      await this.memoriaOuFalha().set(key, value, 'EX', ttlSeconds);
    } else {
      await this.memoriaOuFalha().set(key, value);
    }
  }

  async getSession<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    try {
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async getTtl(key: string): Promise<number> {
    try {
      if (this.isConnected && this.client) {
        return await this.client.ttl(key);
      }
    } catch {
      // Fallback
    }
    return await this.memoriaOuFalha().ttl(key);
  }

  async deleteKey(key: string): Promise<number> {
    try {
      if (this.isConnected && this.client) {
        return await this.client.del(key);
      }
    } catch {
      // Fallback
    }
    return await this.memoriaOuFalha().del(key);
  }

  // Devolve uma tentativa ao contador (ex.: login que deu certo não deve contar contra o IP).
  // Só se a chave ainda existir: um DECR depois de ela expirar criaria um contador -1 sem validade, que nunca
  // mais expira e acumula erros para sempre (o IP da recepção ficaria bloqueado de vez).
  async devolverTentativa(key: string): Promise<void> {
    try {
      if (this.isConnected && this.client) {
        await this.client.eval(
          "if redis.call('EXISTS', KEYS[1]) == 1 and tonumber(redis.call('GET', KEYS[1])) > 0 then return redis.call('DECR', KEYS[1]) end return 0",
          1, key,
        );
        return;
      }
    } catch {
      // Fallback
    }
    await this.memoriaOuFalha().decr(key);
  }

  async rateLimit(key: string, maxRequests = 40, windowSeconds = 60): Promise<{ allowed: boolean; remaining: number }> {
    try {
      if (this.isConnected && this.client) {
        // Atômico, e a validade é posta sempre que faltar (não só no 1º incremento): um contador nunca fica eterno
        const count = Number(await this.client.eval(
          "local c = redis.call('INCR', KEYS[1]) if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return c",
          1, key, String(windowSeconds),
        ));
        return {
          allowed: count <= maxRequests,
          remaining: Math.max(0, maxRequests - count),
        };
      }
    } catch {
      // Fallback
    }
    const count = await this.memoriaOuFalha().incr(key);
    if (count === 1) {
      await this.memoriaOuFalha().expire(key, windowSeconds);
    }
    return {
      allowed: count <= maxRequests,
      remaining: Math.max(0, maxRequests - count),
    };
  }

  // Contador com janela deslizante: cada incremento renova a validade (expira só depois de `windowSeconds` sem uso).
  // Para erros de login: enquanto o ataque continua, o contador não zera no meio dele
  async incrementarRenovando(key: string, windowSeconds: number): Promise<number> {
    try {
      if (this.isConnected && this.client) {
        return Number(await this.client.eval(
          "local c = redis.call('INCR', KEYS[1]) redis.call('EXPIRE', KEYS[1], ARGV[1]) return c",
          1, key, String(windowSeconds),
        ));
      }
    } catch {
      // Fallback
    }
    const count = await this.memoriaOuFalha().incr(key);
    await this.memoriaOuFalha().expire(key, windowSeconds);
    return count;
  }

  isUsingRedis(): boolean {
    return this.isConnected;
  }
}

export const redisService = new RedisManager();
