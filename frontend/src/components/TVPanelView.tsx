import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Appointment, Employee } from '../types';
import { getLocalTodayString } from '../features/appointments/utils/appointmentCore';
import { motion, AnimatePresence } from 'motion/react';

interface TVPanelViewProps {
  appointments: Appointment[];
  employees: Employee[];
  onExit: () => void;
  companyName?: string;
  companyIcon?: string;
}

const formatClientName = (fullName: string) => {
  if (!fullName) return '';
  const parts = fullName.trim().split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const initials = parts.slice(1).map(p => p.charAt(0).toUpperCase() + '.').join(' ');
  return `${first} ${initials}`;
};

// Relógio isolado: o tique de 1 s redesenha só ele, não o painel inteiro
function TVClock() {
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <h2 className="text-6xl font-light tabular-nums">{currentTime.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</h2>;
}

export function TVPanelView({ appointments, employees, onExit, companyName, companyIcon }: TVPanelViewProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [weather, setWeather] = useState<{ temp: number; description: string; icon: string } | null>(null);
  const [tvConfig, setTvConfig] = useState(() => {
    const saved = localStorage.getItem('spa_tv_config');
    return saved ? JSON.parse(saved) : {
      bgAnimated: true,
      emptyMode: 'qr', // 'qr', 'text', 'logo'
      emptyTitle: 'Aproveite sua jornada',
      emptyText: 'Escaneie o QR Code para acessar nosso cardápio digital de chás e serviços extras. Acomode-se, seu momento de paz já vai começar.',
      qrUrl: 'https://serenidadespa.com/menu'
    };
  });


  // Data no fuso de Brasília (toISOString usaria UTC e viraria o dia às 21h)
  const todayStr = getLocalTodayString();

  // Filtra e organiza os agendamentos de hoje
  const upcoming = useMemo(() => appointments
    .filter(a => a.date === todayStr && a.status === 'scheduled')
    .sort((a, b) => a.time.localeCompare(b.time)), [appointments, todayStr]);

  // Busca o Clima automaticamente pela rede (Open-Meteo + IP-API)
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const geoRes = await fetch('https://ipapi.co/json/');
        const geoData = await geoRes.json();
        
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geoData.latitude}&longitude=${geoData.longitude}&current_weather=true`);
        const weatherData = await weatherRes.json();
        
        const temp = Math.round(weatherData.current_weather.temperature);
        const code = weatherData.current_weather.weathercode;
        
        let icon = 'routine'; let description = 'Limpo';
        if (code <= 1) { icon = 'sunny'; description = 'Ensolarado'; }
        else if (code <= 3) { icon = 'partly_cloudy_day'; description = 'Nublado'; }
        else if (code <= 69) { icon = 'rainy'; description = 'Chuvoso'; }
        else if (code <= 79) { icon = 'ac_unit'; description = 'Frio/Neve'; }
        else { icon = 'thunderstorm'; description = 'Tempestade'; }

        setWeather({ temp, description, icon });
      } catch (err) {
        console.error('Erro ao buscar clima:', err);
      }
    };

    fetchWeather();
    const weatherTimer = setInterval(fetchWeather, 30 * 60 * 1000); // Atualiza a cada 30 min
    return () => clearInterval(weatherTimer);
  }, []);

  // Efeito para forçar o Modo Tela Cheia ao abrir
  useEffect(() => {
    const enterFullscreen = async () => {
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch (err) {
        console.warn("O navegador bloqueou a tela cheia automática.", err);
      }
    };
    
    enterFullscreen();

    // Limpeza: Sai da tela cheia quando o componente for fechado
    return () => {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // Escuta mudanças no modo tela cheia para atualizar o ícone do botão
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch (err) {
        console.warn("Erro ao tentar entrar em tela cheia:", err);
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen().catch(() => {});
      }
    }
  };

  // Escuta mudanças feitas no painel do Supervisor em outra aba e atualiza a TV na hora!
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'spa_tv_config' && e.newValue) {
        setTvConfig(JSON.parse(e.newValue));
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Lógica para detectar novos agendamentos e tocar o som
  const isFirstRender = useRef(true);
  const firstUpcomingId = upcoming[0]?.id;
  const prevFirstId = useRef(firstUpcomingId);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevFirstId.current = firstUpcomingId;
      return;
    }

    if (firstUpcomingId && firstUpcomingId !== prevFirstId.current) {
      // Toca um som suave de notificação elegante (taça de cristal / sino tibetano)
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2496/2496-preview.mp3');
      audio.play().catch(e => console.log('O áudio não pôde ser reproduzido automaticamente:', e));
    }
    
    prevFirstId.current = firstUpcomingId;
  }, [firstUpcomingId]);

  return (
    <div className="min-h-screen bg-[#001410] text-white p-8 md:p-16 flex flex-col fixed inset-0 z-200 antialiased">
      <div className="flex justify-between items-center mb-12 border-b border-white/10 pb-8">
        <div className="flex items-center gap-6">
          <span className="material-symbols-outlined text-6xl text-[#afefdd]">{companyIcon || 'storefront'}</span>
          <h1 className="text-5xl font-serif italic text-[#afefdd]">{companyName || 'Painel de Chamada'}</h1>
        </div>
        <div className="text-right flex items-center gap-6">
        {weather && (
          <div className="flex items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/10 shadow-sm mr-4">
            <span className="material-symbols-outlined text-4xl text-[#afefdd]">{weather.icon}</span>
            <div className="text-left">
              <p className="text-2xl font-bold leading-none">{weather.temp}°C</p>
              <p className="text-[10px] uppercase tracking-widest text-white/60 mt-1">{weather.description}</p>
            </div>
          </div>
        )}
        <button onClick={toggleFullscreen} className="opacity-20 hover:opacity-100 transition-opacity" title={isFullscreen ? "Sair da Tela Cheia" : "Tela Cheia"}><span className="material-symbols-outlined text-4xl">{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span></button>
          <button onClick={onExit} className="opacity-20 hover:opacity-100 transition-opacity"><span className="material-symbols-outlined text-4xl">close</span></button>
          <TVClock />
        </div>
      </div>
      
      <h3 className="text-2xl font-bold uppercase tracking-[0.2em] text-[#afefdd] mb-10">Próximos Atendimentos</h3>
      
      <div className="grid gap-6">
        <AnimatePresence mode="popLayout">
          {upcoming.slice(0, 5).map((app, index) => {
            const emp = employees.find(e => e.id === app.assignedEmployeeId);
            const isNext = index === 0;
            return (
              <motion.div 
                layout
                initial={{ opacity: 0, x: -50, scale: 0.95 }}
                animate={{ opacity: isNext ? 1 : 0.6, x: 0, scale: isNext ? 1 : 0.98 }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                transition={{ duration: 0.6, type: "spring", bounce: 0.3 }}
                key={app.id} 
                className={`relative border p-8 rounded-3xl shadow-2xl overflow-hidden ${isNext ? 'bg-[#afefdd]/10 border-[#afefdd]/30' : 'bg-white/5 border-white/10'}`}
              >
                {isNext && (
                  <div className="absolute top-4 right-6 flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#afefdd] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-[#afefdd]"></span>
                    </span>
                    <span className="text-[#afefdd] text-sm font-bold uppercase tracking-widest">Chamando Agora</span>
                  </div>
                )}
                <div className="grid grid-cols-12 gap-6 items-center">
                  <div className="col-span-3 lg:col-span-2">
                    <div className={`text-5xl lg:text-6xl font-bold tabular-nums ${isNext ? 'text-white' : 'text-[#afefdd]'}`}>{app.time}</div>
                  </div>
                  <div className="col-span-5 lg:col-span-6 border-l border-white/10 pl-6">
                    <h4 className="text-3xl lg:text-4xl font-bold text-white mb-2 truncate">{formatClientName(app.clientName)}</h4>
                    <p className={`text-xl lg:text-2xl truncate ${isNext ? 'text-[#afefdd]/80' : 'text-white/60'}`}>{app.services.join(', ')}</p>
                  </div>
                  <div className="col-span-4 text-right border-l border-white/10 pl-6">
                    <p className="text-xl lg:text-2xl text-[#afefdd] uppercase tracking-widest truncate">{emp?.name?.split(' ')[0] || 'Não atribuído'}</p>
                    <p className="text-lg lg:text-xl text-white/50 truncate">{emp?.specialty || 'Profissional'}</p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {upcoming.length === 0 && (
          <div className="text-center py-32 opacity-50 flex flex-col items-center"><span className="material-symbols-outlined text-8xl mb-6">event_available</span><p className="text-4xl font-light">Nenhum atendimento no momento.</p></div>
        )}
      </div>
    </div>
  );
}