-- Turnos padrão da escala: antes ficavam só na memória do navegador (sumiam ao recarregar)
CREATE TABLE "Turno" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "inicio" TEXT NOT NULL,
    "fim" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Turno_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Turno_inicio_fim_key" ON "Turno"("inicio", "fim");

-- Os mesmos turnos que o editor de dia oferecia fixos no código
INSERT INTO "Turno" ("id", "nome", "inicio", "fim") VALUES
    ('turno-manha', 'Manhã', '06:00', '14:00'),
    ('turno-tarde', 'Tarde', '14:00', '22:00'),
    ('turno-noite', 'Noite', '22:00', '06:00'),
    ('turno-comercial', 'Comercial', '08:00', '18:00'),
    ('turno-integral', 'Integral', '07:00', '19:00');
