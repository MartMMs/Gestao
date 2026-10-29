import jwt from 'jsonwebtoken';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('Defina JWT_SECRET no .env antes de rodar o teste de estresse.');
  process.exit(1);
}

async function main() {
  try {
    // 1. Criando um token válido de supervisor
    const AUTH_TOKEN = jwt.sign({ id: 'admin', papel: 'supervisor' }, JWT_SECRET, { expiresIn: '8h' });

    // 2. Usando um ID real extraído via psql do banco de dados
    const COLABORADOR_ID = process.env.COLABORADOR_ID;
    if (!COLABORADOR_ID) throw new Error('Defina COLABORADOR_ID com o id de um colaborador do banco.');

    console.log(`[x] Gerado Token Supervisor: ${AUTH_TOKEN.substring(0, 15)}...`);
    console.log(`[x] Selecionado Colaborador ID Real: ${COLABORADOR_ID}`);

    // 3. Pegando uma data futuramente segura (Amanhã, às 10:00)
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    const yyyy = amanha.getFullYear();
    const mm = String(amanha.getMonth() + 1).padStart(2, '0');
    const dd = String(amanha.getDate()).padStart(2, '0');
    const DATE = `${yyyy}-${mm}-${dd}`;
    const TIME = "11:00";

    console.log(`[x] Data/Hora do Agendamento a testar: ${DATE} às ${TIME}`);
    console.log("\n>>> Preparando bombardeio (10 requisições disparadas paralelamente)...\n");

    const command = `API_BASE_URL=http://localhost:${process.env.PORT || 3333}/api AUTH_TOKEN="${AUTH_TOKEN}" COLABORADOR_ID="${COLABORADOR_ID}" DATE="${DATE}" TIME="${TIME}" REQUESTS=10 node "${path.join(__dirname, 'stress-agendamento.mjs')}"`;

    execSync(command, { stdio: 'inherit' });

  } catch (err) {
    console.error("Erro na execução do teste:", err.message);
  }
}

main();
