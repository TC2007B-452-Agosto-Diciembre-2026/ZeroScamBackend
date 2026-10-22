// Vigilante de disponibilidad (RNF05): consulta /health y avisa al equipo si
// el servicio deja de contestar y cuando vuelve. Corre como el contenedor
// `monitor` de deploy/back/docker-compose.yml. El aviso es un correo a Mailpit
// (la red del proyecto es local, sin salida a un correo real); se lee en
// http://localhost:8025 y queda también en el registro del contenedor.
//
//   npm run build && HEALTH_URL=http://127.0.0.1:3000/health SMTP_URL=smtp://127.0.0.1:1025 node scripts/vigilar-salud.mjs
//
// Variables (todas opcionales):
//   HEALTH_URL               dirección a consultar (http://api:3000/health)
//   HEALTH_INTERVAL_SECONDS  cada cuánto consulta (30)
//   HEALTH_FAILURES          fallas seguidas para avisar (3)
//   ALERT_TO                 destinatario del aviso en Mailpit (equipo@zeroscam.local)
//   SMTP_URL                 Mailpit (smtp://mailpit:1025)
import nodemailer from 'nodemailer';
import { HealthWatchdog } from '../dist/health/watchdog.js';

const url = process.env.HEALTH_URL ?? 'http://127.0.0.1:3000/health';
const intervalMs = Number(process.env.HEALTH_INTERVAL_SECONDS ?? 30) * 1000;
const failuresToAlert = Number(process.env.HEALTH_FAILURES ?? 3);
const to = (process.env.ALERT_TO || 'equipo@zeroscam.local').split(',').map((s) => s.trim()).filter(Boolean);
const smtp = process.env.SMTP_URL;
const from = process.env.MAIL_FROM || 'vigilante@zeroscam.local';

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const transport = smtp ? nodemailer.createTransport(smtp) : undefined;

async function notify(subject, body) {
  log(`AVISO: ${subject}. ${body}`);
  if (!transport) {
    log('Sin SMTP_URL: el aviso solo queda en este registro.');
    return;
  }
  try {
    await transport.sendMail({ from, to, subject, text: body });
  } catch (err) {
    log(`No se pudo mandar el aviso a Mailpit: ${err}`);
  }
}

const watchdog = new HealthWatchdog({
  failuresToAlert,
  notify,
  check: async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  },
});

log(`Vigilando ${url} cada ${intervalMs / 1000} s; avisa tras ${failuresToAlert} fallas seguidas.`);
let lastDown = false;
let tickCount = 0;
const reportEvery = Math.max(1, Math.round(3_600_000 / intervalMs));
async function loop() {
  await watchdog.tick();
  const a = watchdog.availability();
  if (a.down !== lastDown) log(a.down ? 'El servicio no responde.' : 'El servicio volvió a responder.');
  lastDown = a.down;
  if (++tickCount % reportEvery === 0) log(`Disponibilidad desde que arrancó: ${a.percent} % (${a.ok}/${a.checks} consultas).`);
}
await loop();
const timer = setInterval(() => void loop(), intervalMs);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(timer); process.exit(0); });
