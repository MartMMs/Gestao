-- Reconcilia o histórico de migrations com o schema: tabelas e colunas que existiam no banco
-- de desenvolvimento mas nunca tinham migration (instalações novas e o CI precisam delas).
-- AlterTable
ALTER TABLE "Agendamento" ADD COLUMN     "lockExpiresAt" TIMESTAMP(3),
ADD COLUMN     "metodoPagamento" TEXT,
ADD COLUMN     "observacoesSaude" TEXT,
ADD COLUMN     "pixCopiaECola" TEXT,
ADD COLUMN     "pixQrCode" TEXT,
ADD COLUMN     "reservaOrigem" TEXT DEFAULT 'interno',
ADD COLUMN     "salaId" TEXT,
ADD COLUMN     "statusPagamento" TEXT DEFAULT 'pendente',
ADD COLUMN     "valorSinal" DOUBLE PRECISION,
ADD COLUMN     "valorTotal" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "observacao" TEXT;

-- AlterTable
ALTER TABLE "Colaborador" ADD COLUMN     "diasTrabalho" TEXT DEFAULT '1,2,3,4,5,6';

-- AlterTable
ALTER TABLE "EscalaOverride" ALTER COLUMN "atualizadoEm" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SolicitacaoTroca" ALTER COLUMN "atualizadoEm" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Sala" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "numero" INTEGER,
    "capacidade" INTEGER NOT NULL DEFAULT 1,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "descricao" TEXT,

    CONSTRAINT "Sala_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bloqueio" (
    "id" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFim" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "colaboradorId" TEXT NOT NULL,

    CONSTRAINT "Bloqueio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracaoAutoatendimento" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "exigirPagamento" BOOLEAN NOT NULL DEFAULT true,
    "percentualSinal" DOUBLE PRECISION NOT NULL DEFAULT 40.0,
    "tempoLockMinutos" INTEGER NOT NULL DEFAULT 10,
    "permitirCancelamento" BOOLEAN NOT NULL DEFAULT true,
    "tempoMinimoCancelamentoHoras" INTEGER NOT NULL DEFAULT 4,
    "instrucoesCheckin" TEXT DEFAULT 'Chegue com 10 minutos de antecedência para recepção e confirmação do seu atendimento.',
    "mensagemBoasVindas" TEXT DEFAULT 'Bem-vindo ao nosso sistema de autoatendimento. Reserve seu horário com facilidade.',
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoAutoatendimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfiguracaoEmpresa" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "nomeEmpresa" TEXT NOT NULL DEFAULT 'OmniGestão - Atendimentos & Agendamentos',
    "segmento" TEXT NOT NULL DEFAULT 'geral',
    "slogan" TEXT DEFAULT 'Gestão inteligente e experiência de excelência para seus clientes.',
    "icone" TEXT DEFAULT 'storefront',
    "termoAtendimento" TEXT DEFAULT 'Atendimento',
    "termoProfissional" TEXT DEFAULT 'Profissional',
    "termoEspaco" TEXT DEFAULT 'Sala / Espaço',
    "termoServico" TEXT DEFAULT 'Serviço',
    "telefoneContato" TEXT DEFAULT '(11) 99999-8888',
    "emailContato" TEXT DEFAULT 'contato@empresa.com',
    "endereco" TEXT DEFAULT 'Av. Principal, 1000 - Centro',
    "corTemaPrimaria" TEXT DEFAULT '#0f766e',
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sala_nome_key" ON "Sala"("nome");

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_salaId_fkey" FOREIGN KEY ("salaId") REFERENCES "Sala"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bloqueio" ADD CONSTRAINT "Bloqueio_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

