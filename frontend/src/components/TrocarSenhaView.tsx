import React, { useState } from 'react';
import { SESSAO_COOKIE, fetchApi, isApiError } from '../api';
import { useAuth } from '../AuthContext';
import { SENHA_MAXIMA, SENHA_MINIMA, validarSenha } from '@shared/senha';

const campo = 'w-full bg-surface-container border border-outline-variant rounded-xl p-4 focus:ring-1 focus:ring-primary focus:outline-none text-sm text-on-surface';
const rotulo = 'block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2';

/**
 * Primeiro acesso (ou senha redefinida pela supervisão): a senha atual é provisória, conhecida por outra pessoa.
 * O portal só abre depois que a dona da conta escolhe a dela; o servidor recusa o resto até lá.
 */
export function TrocarSenhaView() {
  const { currentUser, handleLogout, concluirTrocaDeSenha } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    if (!senhaAtual) return setErro('Digite a senha provisória que você usou para entrar.');
    const erroSenha = validarSenha(novaSenha);
    if (erroSenha) return setErro(erroSenha);
    if (novaSenha !== confirmacao) return setErro('A confirmação não é igual à nova senha.');
    if (novaSenha === senhaAtual) return setErro('A nova senha precisa ser diferente da provisória.');
    setErro(null);
    setEnviando(true);
    try {
      const resposta = await fetchApi('/minha-senha', SESSAO_COOKIE, { method: 'POST', body: JSON.stringify({ senhaAtual, senha: novaSenha }) });
      concluirTrocaDeSenha(resposta);
    } catch (error) {
      setErro(isApiError(error) ? error.message : 'Não foi possível trocar a senha. Tente de novo.');
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-surface-container-lowest text-on-surface p-6">
      <form onSubmit={enviar} noValidate className="w-full max-w-md space-y-6" aria-labelledby="trocar-senha-titulo">
        <div>
          <span className="material-symbols-outlined text-5xl mb-4 text-primary" aria-hidden="true">lock_reset</span>
          <h1 id="trocar-senha-titulo" className="text-3xl font-serif italic mb-2">Crie a sua senha</h1>
          <p className="text-sm text-on-surface-variant">
            {currentUser?.name ? `${currentUser.name.split(' ')[0]}, a` : 'A'} senha que você usou foi criada por outra pessoa.
            Escolha uma senha só sua para continuar.
          </p>
        </div>

        {erro && (
          <div role="alert" className="bg-error-container text-on-error-container p-4 rounded-xl text-sm font-medium">{erro}</div>
        )}

        <div>
          <label htmlFor="senha-atual" className={rotulo}>Senha provisória</label>
          <input id="senha-atual" required type="password" autoComplete="current-password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} className={campo} />
        </div>
        <div>
          <label htmlFor="senha-nova" className={rotulo}>Nova senha</label>
          <input id="senha-nova" required type="password" autoComplete="new-password" minLength={SENHA_MINIMA} maxLength={SENHA_MAXIMA} value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} className={campo} aria-describedby="senha-regra" />
          <p id="senha-regra" className="text-[11px] text-on-surface-variant mt-1">De {SENHA_MINIMA} a {SENHA_MAXIMA} caracteres.</p>
        </div>
        <div>
          <label htmlFor="senha-confirmacao" className={rotulo}>Repita a nova senha</label>
          <input id="senha-confirmacao" required type="password" autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} className={campo} />
        </div>

        <button type="submit" disabled={enviando} className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold text-sm uppercase tracking-[0.2em] disabled:opacity-70">
          {enviando ? 'Salvando...' : 'Salvar e entrar'}
        </button>
        <button type="button" onClick={handleLogout} className="w-full text-xs text-on-surface-variant underline">Sair</button>
      </form>
    </div>
  );
}
