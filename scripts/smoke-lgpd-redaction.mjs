import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env'), quiet: true });

const API = process.env.API_URL || `http://localhost:${process.env.PORT || 3333}/api`;
// Contas de teste criadas por `npm --prefix backend run seed:ci`
const SENHA = process.env.E2E_PASSWORD;
if (!SENHA) {
  console.error('Defina E2E_PASSWORD no .env e rode `npm --prefix backend run seed:ci`.');
  process.exit(1);
}

// CPF aleatório com dígitos verificadores válidos (não colide com clientes reais)
const gerarCpf = () => {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (digitos, peso) => {
    const resto = (digitos.reduce((t, d, i) => t + d * (peso - i), 0) * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = dv(base, 10);
  const d2 = dv([...base, d1], 11);
  return [...base, d1, d2].join('').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

const parseResponse = async (res) => {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
};

const request = async (path, options = {}, token) => {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  return parseResponse(res);
};

const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Só os 2 últimos dígitos ficam visíveis (ver backend/lib/privacidade.ts)
const maskedPhonePattern = /^\(\*{2}\)\s\*{5}-\*{2}\d{2}$/;
const maskedCpfPattern = /^\*{3}\.\*{3}\.\*{3}-\d{2}$/;

const run = async () => {
  const created = { appointmentId: null };

  const supervisorLogin = await request('/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@serenidade.com', senha: SENHA }),
  });
  const supervisorToken = supervisorLogin.body?.token;

  const collaboratorLogin = await request('/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'ana@serenidade.com', senha: SENHA }),
  });
  if (!collaboratorLogin.ok || !collaboratorLogin.body?.token) {
    throw new Error('COLLABORATOR_LOGIN_FAILED');
  }
  const collaboratorToken = collaboratorLogin.body.token;

  // A colaboradora agenda para si mesma
  const collaborator = collaboratorLogin.body.usuario;
  if (!collaborator?.id) {
    throw new Error('COLLABORATOR_NOT_FOUND');
  }

  const services = await request('/servicos', { method: 'GET' }, collaboratorToken);
  const serviceName = Array.isArray(services.body) && services.body[0]?.nome
    ? services.body[0].nome
    : null;
  if (!serviceName) {
    throw new Error('SERVICE_NOT_FOUND');
  }

  let createAsCollaborator = { status: -1, body: null };
  let selectedDate = null;
  let selectedTime = null;

  for (let dayOffset = 2; dayOffset <= 20 && createAsCollaborator.status !== 201; dayOffset += 1) {
    for (let hour = 9; hour <= 19 && createAsCollaborator.status !== 201; hour += 1) {
      for (const minute of [0, 15, 30, 45]) {
        const day = new Date();
        day.setDate(day.getDate() + dayOffset);
        const date = fmtDate(day);
        const hh = String(hour).padStart(2, '0');
        const mm = String(minute).padStart(2, '0');

        const attempt = await request('/agendamentos', {
          method: 'POST',
          body: JSON.stringify({
            clientName: `QA LGPD ${Date.now()}`,
            collaboratorId: collaborator.id,
            date: `${date}T${hh}:${mm}:00.000-03:00`,
            serviceNames: [serviceName],
            contact: `(11) 9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
            cpf: gerarCpf(),
          }),
        }, collaboratorToken);

        if (attempt.status === 201) {
          createAsCollaborator = attempt;
          selectedDate = date;
          selectedTime = `${hh}:${mm}`;
          if (attempt.body?.id) created.appointmentId = attempt.body.id;
          break;
        }

        if (attempt.status !== 409 && attempt.status !== 400) {
          createAsCollaborator = attempt;
          break;
        }
      }
    }
  }

  const appointmentsAsCollaborator = await request('/agendamentos', { method: 'GET' }, collaboratorToken);
  const reportAsCollaborator = await request('/agendamentos/relatorio/concluidos', { method: 'GET' }, collaboratorToken);

  const createdInList = Array.isArray(appointmentsAsCollaborator.body)
    ? appointmentsAsCollaborator.body.find((item) => item?.id === created.appointmentId)
    : null;

  const createdClient = createAsCollaborator.body?.cliente || null;
  const listedClient = createdInList?.cliente || null;

  const checks = {
    createStatus: createAsCollaborator.status,
    listStatus: appointmentsAsCollaborator.status,
    reportStatus: reportAsCollaborator.status,
    createPhoneMasked: typeof createdClient?.telefone === 'string' ? maskedPhonePattern.test(createdClient.telefone) : false,
    createCpfMasked: typeof createdClient?.cpf === 'string' ? maskedCpfPattern.test(createdClient.cpf) : false,
    listPhoneMasked: typeof listedClient?.telefone === 'string' ? maskedPhonePattern.test(listedClient.telefone) : false,
    listCpfMasked: typeof listedClient?.cpf === 'string' ? maskedCpfPattern.test(listedClient.cpf) : false,
  };

  const pass = (
    checks.createStatus === 201 &&
    checks.listStatus === 200 &&
    checks.reportStatus === 200 &&
    checks.createPhoneMasked &&
    checks.createCpfMasked &&
    checks.listPhoneMasked &&
    checks.listCpfMasked
  );

  console.log('LGPD_REDACTION_SMOKE', JSON.stringify({
    checks,
    selectedDate,
    selectedTime,
    sample: { createdClient, listedClient },
    pass,
  }, null, 2));

  // Remove o cliente de teste (e o agendamento dele) para não deixar restos no banco
  const createdClientId = createAsCollaborator.body?.clienteId;
  if (createdClientId && supervisorToken) {
    await request(`/clientes/${createdClientId}`, { method: 'DELETE' }, supervisorToken);
  } else if (created.appointmentId && supervisorToken) {
    await request(`/agendamentos/${created.appointmentId}`, { method: 'DELETE' }, supervisorToken);
  }

  if (!pass) {
    process.exitCode = 2;
  }
};

run().catch((error) => {
  console.error('LGPD_REDACTION_SMOKE_ERROR', error?.message || error);
  process.exitCode = 1;
});
