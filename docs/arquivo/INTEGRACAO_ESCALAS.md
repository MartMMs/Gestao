# 🔌 Guia de Integração - Sistema de Escalas

## Como Usar os Novos Utils

### 1. Validação CLT em Tempo Real

```typescript
// Importar no seu componente
import { analisarConformidadeCLT } from '../utils/cltValidator';

// Usar ao salvar agendamentos
const analise = analisarConformidadeCLT(
  meusAgendamentos,
  meusBloqueios,
  dataAtual
);

// Exibir alertas se não conforme
if (!analise.statusGeral) {
  setErrorMessage(analise.resumo.join('\n'));
}
```

### 2. Calcular Carga Semanal

```typescript
import { calcularCargaSemanal, validarCargaSemanal } from '../utils/cltValidator';

const { cargaTotal, semana } = calcularCargaSemanal(
  appointments,
  bloqueios,
  dataAtual
);

const validacao = validarCargaSemanal(cargaTotal);

// Mostrar em card
<Card>
  <p>Carga: {cargaTotal}h / {validacao.percentualUtilizacao}%</p>
  {validacao.alertas.map(a => <Alert key={a}>{a}</Alert>)}
</Card>
```

### 3. Gerar Escalas Praticamente

```typescript
import { gerarEscala } from '../utils/escalaCalculator';

// Gerar 4 semanas de escala 6x1
const escala6x1 = gerarEscala(
  {
    tipo: '6x1',
    dataInicio: '2026-04-03'
  },
  28 // dias
);

// Exibir dias de folga
escala6x1
  .filter(d => d.tipo === 'folga')
  .forEach(d => console.log(`Folga em ${d.data}`));
```

### 4. Verificar Feriados

```typescript
import { ehFeriado, obterNomeFeriado } from '../utils/feriadosBR';

if (ehFeriado('2026-04-21')) {
  console.log('É feriado:', obterNomeFeriado('2026-04-21'));
}

// Obter feriados do mês
import { obterFeriadosMes } from '../utils/feriadosBR';

const feriadosAbril = obterFeriadosMes(2026, 4);
// { 3: 'Sexta-feira Santa', 21: 'Tiradentes' }
```

---

## Integração no Dashboard (FASE 2)

### Adicionar Painel de Conformidade CLT

```typescript
// SupervisorView.tsx - Nova aba "Conformidade"

const [cameraTab, setActiveTab] = useState<'agenda' | 'equipe' | 'escala' | 'conformidade'>('agenda');

{activeTab === 'conformidade' && (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {employees.map(emp => {
        const analise = analisarConformidadeCLT(
          appointments.filter(a => a.assignedEmployeeId === emp.id),
          emp.bloqueios || [],
          getLocalTodayString()
        );
        
        return (
          <Card key={emp.id} className={analise.statusGeral ? 'border-green-500' : 'border-red-500'}>
            <h3>{emp.name}</h3>
            {analise.resumo.map(r => (
              <p key={r}>{r}</p>
            ))}
          </Card>
        );
      })}
    </div>
  </motion.div>
)}
```

---

## Integração no Cadastro de Colaborador

### Expandir FormulárioCollaborator

```typescript
// SupervisorEquipeTab.tsx - Adicionar campos

<input 
  type="text" 
  value={newEmpCargo}
  onChange={e => setNewEmpCargo(e.target.value)}
  placeholder="Cargo (Ex: Massoterapista)" />

<select value={newEmpTipoEscala} onChange={e => setNewEmpTipoEscala(e.target.value)}>
  <option value="6x1">6x1 (6 dias trab, 1 folga)</option>
  <option value="5x2">5x2 (5 dias trab, 2 folgas)</option>
  <option value="12x36">12x36 (12h trab, 36h folga)</option>
  <option value="rotativo">Rotativo (3 turnos)</option>
</select>

<input 
  type="number" 
  value={newEmpCargaHoraria}
  onChange={e => setNewEmpCargaHoraria(Number(e.target.value))}
  placeholder="Carga horária semanal (Ex: 40)" />

<div>
  <label>Habilidades:</label>
  {['Massagem', 'Acupuntura', 'Fisioterapia'].map(h => (
    <checkbox 
      key={h}
      checked={newEmpHabilidades.includes(h)}
      onChange={() => toggleHabilidade(h)} />
  ))}
</div>
```

---

## Criar Modal de "Solicitar Troca"

```typescript
// components/SolicitarTroca.tsx - NOVO COMPONENTE

export function SolicitarTroca({ 
  open, 
  onClose, 
  colaboradorId, 
  appointments,
  onSubmitTroca 
}: Props) {
  const [dataOriginal, setDataOriginal] = useState('');
  const [dataSolicitada, setDataSolicitada] = useState('');
  const [motivo, setMotivo] = useState('');

  const turnoOriginal = appointments.find(a => a.date === dataOriginal && a.assignedEmployeeId === colaboradorId);
  
  return (
    <Modal open={open} onClose={onClose}>
      <h2>Solicitar Troca de Turno</h2>
      
      <input type="date" value={dataOriginal} onChange={e => setDataOriginal(e.target.value)} />
      {turnoOriginal && <p>Turno: {turnoOriginal.time}</p>}
      
      <input type="date" value={dataSolicitada} onChange={e => setDataSolicitada(e.target.value)} />
      <textarea value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo da troca" />
      
      <button onClick={() => onSubmitTroca({
        dataOriginal,
        dataSolicitada,
        motivo,
        status: 'pendente'
      })}>
        Solicitar Troca
      </button>
    </Modal>
  );
}
```

---

## Adicionar Visualização de Calendario de Escalas

```typescript
// components/CalendarioEscala.tsx - NOVO COMPONENTE

export function CalendarioEscala({ 
  escalas, // DiaEscala[]
  nomeMes: string 
}) {
  const [mes] = = useState(6); // Abril = 6
  const [ano] = useState(2026);
  
  // Agrupar escalas por data
  const calendarioMap = new Map<number, DiaEscala>();
  escalas.forEach(e => {
    const dia = parseInt(e.data.split('-')[2]);
    calendarioMap.set(dia, e);
  });
  
  return (
    <div className="grid grid-cols-7 gap-1">
      {/* Cabeçalhos DSeg-Dom */}
      {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(d => (
        <div key={d} className="font-bold text-center">{d}</div>
      ))}
      
      {/* Dias do mês */}
      {Array.from({ length: 31 }).map((_, i) => {
        const dia = i + 1;
        const escala = calendarioMap.get(dia);
        
        return (
          <div 
            key={dia}
            className={`
              p-2 rounded border text-center text-sm font-bold
              ${escala?.tipo === 'trabalho' ? 'bg-green-100' : 'bg-orange-100'}
              ${escala?.tipo === 'folga' ? 'bg-blue-100' : ''}
            `}
            title={escala?.descricao}
          >
            <div>{dia}</div>
            <div className="text-[10px]">{escala?.turno || '-'}</div>
          </div>
        );
      })}
    </div>
  );
}
```

---

## Dashboard de Métricas (Widget)

```typescript
// components/DashboardEscalas.tsx

export function DashboardEscalas({ employees, appointments }) {
  const metricas = employees.map(emp => {
    const { horasTrabalhadas, diasTrabalho } = calcularHorasEscala(
      gerarEscala({ tipo: emp.tipoEscala as TipoEscala, dataInicio: getLocalTodayString() }, 28)
    );
    
    return {
      nome: emp.name,
      horas: horasTrabalhadas,
      dias: diasTrabalho,
      tipo: emp.tipoEscala
    };
  });
  
  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <h3>📊 Horas Médias</h3>
        <p className="text-2xl font-bold">
          {(metricas.reduce((s, m) => s + m.horas, 0) / metricas.length).toFixed(1)}h
        </p>
      </Card>
      
      <Card>
        <h3>👥 Colaboradores</h3>
        <p className="text-2xl font-bold">{employees.length}</p>
      </Card>
      
      <Card>
        <h3>⚠️ Alertas CLT</h3>
        <p className="text-2xl font-bold">
          {employees.filter(e => {
            const a = analisarConformidadeCLT(
              appointments.filter(ap => ap.assignedEmployeeId === e.id),
              e.bloqueios || [],
              getLocalTodayString()
            );
            return !a.statusGeral;
          }).length}
        </p>
      </Card>
    </div>
  );
}
```

---

## Próximas Etapas de Integração

1. [x] **Atualizar types.ts** com novos campos de Employee
2. [x] **Expandir formulário** de colaborador em SupervisorEquipeTab
3. [x] **Adicionar aba "Escalas"** com visualização em calendário
4. [x] **Criar modal de troca** de turno
5. [x] **Adicionar dashboard** de conformidade CLT
6. [x] **Implementar alertas** em tempo real

---

**Status:** ✅ Integração principal de Escalas concluída na UI (Tipos, Formulário, Calendário, Troca, Dashboard e Alertas CLT)

## Ajuste de Escala Dominical (Configuração de Folgas)

- [x] Suporte ao tipo de escala `5x1` adicionado.
- [x] Campo por colaborador para `folgasDomingoNoMes` implementado (ex.: 2 folgas no domingo por mês).
- [x] Aplicação automática da regra no calendário de escalas da supervisão.
- [x] Persistência no backend (`colaborador`) preparada.

## Persistência de Troca de Turno (Backend + Frontend)

- [x] Rota para listar solicitações: `GET /api/trocas-turno`
- [x] Rota para criar solicitação: `POST /api/trocas-turno`
- [x] Rota para aprovar/rejeitar: `PATCH /api/trocas-turno/:id/status`
- [x] Hook de listagem no frontend (`useTurnoSwapRequests`)
- [x] Hook de criação no frontend (`useAddTurnoSwapRequest`)
- [x] Hook de atualização de status no frontend (`useUpdateTurnoSwapRequestStatus`)
- [x] Integração no colaborador para enviar solicitação
- [x] Integração no supervisor para aprovar/rejeitar pendências

### Passo operacional pendente

- [x] Aplicar migração Prisma no ambiente alvo para materializar a tabela/colunas novas:

```bash
npx prisma migrate deploy
npx prisma generate
```

Evidência 09/04/2026:
- `migrate deploy` executado sem pendências.
- `generate` executado com sucesso (Prisma Client atualizado).
