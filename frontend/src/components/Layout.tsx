import React, { useState, useEffect, useRef } from 'react';
import { Role } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { LinksDocumentosLegais } from './DocumentosLegais';

interface LayoutProps {
  children: React.ReactNode;
  userName: string;
  userRole: Role;
  activeView?: Role | 'tv' | 'autoatendimento';
  onViewChange?: (view: Role | 'tv' | 'autoatendimento') => void;
  onOpenUpcomingAppointments?: () => void;
  upcomingAppointmentsCount?: number;
  cltAlertsCount?: number;
  onOpenCltAlerts?: () => void;
  onLogout: () => void;
  isDarkMode?: boolean;
  toggleTheme?: () => void;
  companyName?: string;
  companyIcon?: string;
}

// Telas que cada papel pode abrir pelo seletor do topo
const VISOES_POR_PAPEL: Record<Role, Array<[Role | 'tv' | 'autoatendimento', string]>> = {
  admin: [['admin', 'Painel Administrador'], ['supervisor', 'Visão Operacional (Supervisor)'], ['collaborator', 'Portal do Colaborador'], ['tv', 'Painel de TV (Recepção)'], ['autoatendimento', 'Autoatendimento (Totem)']],
  supervisor: [['supervisor', 'Portal do Supervisor'], ['collaborator', 'Portal do Colaborador'], ['tv', 'Painel de TV (Recepção)'], ['autoatendimento', 'Autoatendimento (Totem)']],
  // Recepção e profissional não trocam de tela pelo seletor (App só deixa admin e supervisão trocar)
  receptionist: [['receptionist', 'Portal da Recepção']],
  collaborator: [['collaborator', 'Portal do Colaborador']],
};

export function Layout({ children, userName, userRole, activeView, onViewChange, onOpenUpcomingAppointments, upcomingAppointmentsCount = 0, cltAlertsCount = 0, onOpenCltAlerts, onLogout, isDarkMode, toggleTheme, companyName, companyIcon }: LayoutProps) {
  const hasCltAlerts = cltAlertsCount > 0;

  return (
    <div translate="no" className="notranslate min-h-screen flex flex-col bg-surface text-on-surface font-body antialiased transition-colors duration-300">
      {/* TopAppBar */}
      <header className="bg-surface/80 backdrop-blur-md font-headline text-on-surface sticky top-0 z-50 shadow-sm flex flex-wrap justify-between items-center gap-2 w-full px-4 sm:px-8 py-3 sm:py-4 max-w-full">
        <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
          {/* Espaço para a sua Logo */}
          <div className="w-10 h-10 sm:w-11 sm:h-11 bg-primary-container rounded-xl flex items-center justify-center overflow-hidden border border-primary/20 shrink-0 shadow-sm">
            <span className="material-symbols-outlined text-primary text-2xl">{companyIcon || 'storefront'}</span>
          </div>
          <span className="hidden md:block text-2xl font-serif italic text-primary">
            {companyName || 'OmniGestão'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-4 min-w-0">
          <div className="hidden lg:flex items-center gap-2 px-4 py-1 bg-surface-container rounded-full border border-outline-variant/30">
            <span className="material-symbols-outlined text-primary scale-75">badge</span>
            <select
              aria-label="Portal"
              value={activeView}
              onChange={(e) => onViewChange?.(e.target.value as Role | 'tv' | 'autoatendimento')}
              className="bg-transparent border-none text-xs font-semibold text-on-surface-variant uppercase tracking-wide font-body focus:ring-0 cursor-pointer outline-none m-0 p-0"
            >
              {VISOES_POR_PAPEL[userRole].map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
            </select>
          </div>
          {activeView === 'supervisor' && onOpenUpcomingAppointments && (
            <button
              onClick={onOpenUpcomingAppointments}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:text-primary hover:border-primary/40 transition-all"
              title="Abrir lista de próximos atendimentos"
            >
              <span className="material-symbols-outlined text-[18px]">event_upcoming</span>
              <span className="hidden md:block text-[11px] font-bold uppercase tracking-widest">Lista de Hoje</span>
              <span className="rounded-full bg-primary/15 text-primary text-[11px] font-bold px-2 py-0.5">{upcomingAppointmentsCount}</span>
            </button>
          )}
          <div className="flex items-center gap-1.5 sm:gap-3 ml-1 sm:ml-2 pl-2 sm:pl-4 border-l border-outline-variant/30">
            {toggleTheme && (
              <button 
                onClick={toggleTheme} 
                className="text-on-surface-variant hover:bg-surface-container hover:text-primary w-10 h-10 flex items-center justify-center rounded-full transition-all" 
                title={isDarkMode ? "Mudar para Modo Claro" : "Mudar para Modo Escuro"}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span 
                    key={isDarkMode ? 'dark' : 'light'}
                    initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
                    transition={{ duration: 0.2 }}
                    className="material-symbols-outlined block"
                  >
                    {isDarkMode ? 'light_mode' : 'dark_mode'}
                  </motion.span>
                </AnimatePresence>
              </button>
            )}
            {userRole === 'supervisor' && activeView === 'supervisor' && onOpenCltAlerts && (
              <button
                onClick={onOpenCltAlerts}
                className={`relative w-10 h-10 flex items-center justify-center rounded-full transition-all ${
                  hasCltAlerts
                    ? 'text-error bg-error/10 ring-1 ring-error/40 hover:bg-error/15'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-primary'
                }`}
                title="Alertas e Auditoria"
              >
                <span className="material-symbols-outlined">{hasCltAlerts ? 'notifications_active' : 'notifications'}</span>
                {cltAlertsCount > 0 && (
                  <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-error text-on-error text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm border border-surface">
                    {cltAlertsCount > 9 ? '9+' : cltAlertsCount}
                  </span>
                )}
              </button>
            )}
            <span className="text-sm font-bold text-primary hidden md:block">{userName}</span>
            <button 
              onClick={onLogout} 
              className="material-symbols-outlined text-on-surface-variant hover:bg-error-container/20 hover:text-error p-2 rounded-full transition-all" 
              title="Sair"
            >
              logout
            </button>
          </div>
        </div>
      </header>


      <main className="grow flex flex-col items-center px-4 py-12 md:py-16">
        {children}
      </main>

      {/* Footer */}
      <footer className="py-12 px-8 flex flex-col md:flex-row justify-between items-center gap-8 text-on-surface-variant text-[11px] font-medium uppercase tracking-widest border-t border-outline-variant/10 font-body">
        <div className="flex items-center gap-3">
          <span className="font-serif italic text-lg text-primary normal-case tracking-normal">{companyName || 'OmniGestão'}</span>
          <span className="opacity-40">|</span>
          <span>Sistema Interno</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          <LinksDocumentosLegais />
          <span className="text-outline-variant">Uso Exclusivo para Colaboradores</span>
        </div>
      </footer>
    </div>
  );
}
