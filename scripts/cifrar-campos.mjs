// Cifra con AES-256-GCM los textos sensibles de los reportes que ya estaban en
// la base sin cifrar (RNF02): Reporte.descripcion_incidente y
// Reporte.texto_sospechoso. Los reportes nuevos ya se guardan cifrados.
//
//   npm run build
//   npm run cifrar:campos              # solo cuenta cuántos faltan (no cambia nada)
//   npm run cifrar:campos -- --aplicar # los cifra
//
// Es repetible: salta lo que ya trae la marca `enc1:`. Usa DATABASE_URL y
// DATA_KEY del .env. Haz un respaldo antes (mysqldump) y guarda
// DATA_KEY: sin ella los textos cifrados no se pueden leer.
import { existsSync } from 'node:fs';
import { createConnection } from 'mysql2/promise';
import { encryptField } from '../dist/common/field-crypto.js';

if (existsSync('.env')) process.loadEnvFile();
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en .env');
if (!process.env.DATA_KEY) throw new Error('Falta DATA_KEY en .env');

const apply = process.argv.includes('--aplicar');
const COLUMNS = ['descripcion_incidente', 'texto_sospechoso'];
const connection = await createConnection({ uri: process.env.DATABASE_URL });
let pending = 0;
let done = 0;
try {
  for (const column of COLUMNS) {
    const [rows] = await connection.query(
      `SELECT id_reporte, ${column} AS valor FROM Reporte
       WHERE ${column} IS NOT NULL AND ${column} NOT LIKE 'enc1:%'`,
    );
    pending += rows.length;
    console.log(`${column}: ${rows.length} sin cifrar`);
    if (!apply) continue;
    for (const row of rows) {
      await connection.query(`UPDATE Reporte SET ${column} = ? WHERE id_reporte = ? AND ${column} = ?`, [
        encryptField(row.valor),
        row.id_reporte,
        row.valor,
      ]);
      done++;
    }
  }
} finally {
  await connection.end();
}
console.log(apply ? `Cifrados: ${done}.` : `Faltan ${pending}. Corre con --aplicar para cifrarlos.`);
