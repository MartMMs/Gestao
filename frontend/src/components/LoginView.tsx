import React, { useState } from 'react';
import { motion } from 'motion/react';

// Importando a imagem local novamente
import bgImage from '../assets/login-fundo.jpg';

interface LoginViewProps {
  onLogin: (email: string, pass: string) => Promise<void>;
  onOpenTVPanel: () => void;
  onOpenAutoatendimento?: () => void;
  error: string | null;
  companyName?: string;
  companySlogan?: string;
  companyIcon?: string;
}

export function LoginView({
  onLogin,
  onOpenTVPanel,
  onOpenAutoatendimento,
  error,
  companyName,
  companySlogan,
  companyIcon,
}: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState(false);

  // Validação em tempo real do formato de e-mail
  const validateEmail = (val: string) => {
    setEmail(val);
    // Remove o erro enquanto o usuário digita para melhorar a UX
    if (emailError) {
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      if (isValid) {
        setEmailError(false);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Valida no momento do envio
    const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!isValid) {
      setEmailError(true);
      return;
    }

    setIsLoading(true);
    await onLogin(email, password);
    setIsLoading(false); // Desliga o spinner assim que a tentativa terminar (falhando ou não)
  };

  // Preenchimento automático para testes
  // Detecta o horário para uma saudação dinâmica
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-surface-container-lowest text-on-surface antialiased font-body relative">
      {/* Botões Topo - TV e Totem Autoatendimento */}
      <div className="fixed top-6 left-6 flex items-center gap-3 z-50">
        <button
          type="button"
          onClick={onOpenTVPanel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container/90 backdrop-blur-md border border-outline-variant/30 text-primary hover:bg-surface-container hover:border-primary/40 transition-all text-xs font-semibold cursor-pointer shadow-sm"
          title="Abrir Painel TV"
        >
          <span className="material-symbols-outlined text-lg">tv</span>
          <span className="hidden sm:inline">Painel TV</span>
        </button>

        {onOpenAutoatendimento && (
          <button
            type="button"
            onClick={onOpenAutoatendimento}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 backdrop-blur-md border border-primary/30 text-primary hover:bg-primary hover:text-on-primary transition-all text-xs font-semibold cursor-pointer shadow-sm"
            title="Abrir Totem de Autoatendimento do Cliente"
          >
            <span className="material-symbols-outlined text-lg">touch_app</span>
            <span>Autoatendimento</span>
          </button>
        )}
      </div>

      {/* Coluna da Imagem (Esquerda) - Visível em telas médias e maiores */}
      <div 
        className="hidden md:block md:w-1/2 lg:w-3/5 bg-cover bg-center relative"
        style={{ backgroundImage: `url(${bgImage})` }}
      >
        <div className="absolute inset-0 bg-linear-to-t from-black/60 via-black/20 to-transparent"></div>
        <div className="absolute bottom-10 left-10 text-white">
          <h1 className="text-5xl font-serif italic mb-2">{companyName || 'OmniGestão'}</h1>
          <p className="text-lg text-white/80">{companySlogan || 'Plataforma de gestão completa para o seu negócio.'}</p>
        </div>
      </div>

      {/* Coluna do Formulário (Direita) */}
      <div className="w-full min-h-screen md:min-h-0 md:w-1/2 lg:w-2/5 flex flex-col items-center justify-center p-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <div className="text-center mb-10 md:text-left">
            <span className="material-symbols-outlined text-5xl mb-4 text-primary">{companyIcon || 'storefront'}</span>
            <h1 className="text-4xl md:text-5xl font-serif italic mb-2 tracking-wide text-on-surface">
              {companyName ? companyName.split(' ')[0] : 'OmniGestão'}
            </h1>
            <p className="text-sm uppercase tracking-[0.3em] text-on-surface-variant">Sistema de Gestão & Agendamento</p>
            <p className="text-lg font-light text-on-surface-variant mt-4">{greeting}, faça seu login.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <motion.div 
                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                className="bg-error-container text-on-error-container p-4 rounded-xl text-sm font-medium flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-lg">error</span>
                {error}
              </motion.div>
            )}
            
            <div>
              <label htmlFor="email" className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">E-mail</label>
              <input 
                id="email"
                required 
                type="email" 
                value={email} 
                onChange={e => validateEmail(e.target.value)} 
                onBlur={() => { if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) setEmailError(true) }}
                className={`w-full bg-surface-container border ${emailError ? 'border-error focus:ring-error' : 'border-outline-variant focus:ring-primary'} rounded-xl p-4 focus:ring-1 focus:outline-none text-sm transition-all placeholder:text-on-surface-variant text-on-surface`} 
                placeholder="seu@email.com" 
              />
              {emailError && <span className="text-error text-[10px] mt-1 ml-1 font-medium tracking-wide">Formato de e-mail inválido</span>}
            </div>

            <div>
              <label htmlFor="password" className="block text-[10px] font-bold text-on-surface-variant tracking-[0.15em] uppercase mb-2">Senha</label>
              <input 
                id="password"
                required 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                className="w-full bg-surface-container border border-outline-variant rounded-xl p-4 focus:ring-1 focus:ring-primary focus:outline-none text-sm transition-all placeholder:text-on-surface-variant text-on-surface" 
                placeholder="••••••••" 
              />
            </div>

            <button 
              type="submit" 
              disabled={isLoading || emailError}
              className="w-full bg-primary text-on-primary py-4 rounded-xl font-bold text-sm uppercase tracking-[0.2em] shadow-lg hover:bg-primary/90 hover:shadow-xl hover:-translate-y-0.5 transition-all active:scale-[0.98] mt-4 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-on-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Acessando...
                </>
              ) : 'Entrar'}
            </button>
          </form>

        </motion.div>
      </div>
    </div>
  );
}
