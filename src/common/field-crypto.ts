import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

/**
 * Cifrado en reposo de los textos sensibles de un reporte (RNF02): la
 * descripción del incidente y el texto sospechoso. Es AES-256-GCM con la llave
 * `DATA_KEY` (32 bytes en base64).
 *
 * Formato guardado en la columna: `enc1:` + base64(iv | etiqueta | texto
 * cifrado). Un valor sin la marca es de antes del cifrado y se entrega tal
 * cual, para que los reportes viejos se sigan leyendo hasta correr
 * `scripts/cifrar-campos.mjs`.
 */
const PREFIX = 'enc1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Solo para las pruebas automáticas (`NODE_ENV=test`); nunca en producción. */
const TEST_KEY = Buffer.alloc(32, 7);

let key: Buffer | undefined;

/**
 * Llave AES-256 de los textos de los reportes, tomada de `DATA_KEY`.
 *
 * Nunca vive en el código. Sin ella el servidor no arranca (`main.ts` la pide
 * al iniciar). Si se pierde, los textos ya cifrados no se pueden leer:
 * respáldala junto con los respaldos de la base.
 *
 * @throws `Error` si falta `DATA_KEY` o no son 32 bytes en base64.
 */
export function dataKey(): Buffer {
  if (key) return key;
  if (!process.env.DATA_KEY && existsSync('.env')) process.loadEnvFile();
  const value = process.env.DATA_KEY;
  if (!value) {
    if (process.env.NODE_ENV === 'test') return TEST_KEY;
    throw new Error(
      'Falta DATA_KEY (32 bytes en base64): genera una con ' +
        '`openssl rand -base64 32` y ponla en .env',
    );
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 32) {
    throw new Error('DATA_KEY debe ser de 32 bytes en base64 (AES-256)');
  }
  key = decoded;
  return key;
}

/** Cifra un texto con una IV aleatoria: el mismo texto da un resultado distinto cada vez. */
export function encryptField(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', dataKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return (
    PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
  );
}

/**
 * Descifra un valor de la base. Uno sin la marca se regresa igual.
 *
 * @throws `Error` si el valor fue alterado o la llave no es la misma (la
 * etiqueta de GCM no cuadra).
 */
export function decryptField(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Campo cifrado incompleto');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', dataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString(
    'utf8',
  );
}

/** Como {@link encryptField} pero deja pasar `null` y `undefined`. */
export function encryptOptional(
  plain: string | null | undefined,
): string | null | undefined {
  return plain == null ? plain : encryptField(plain);
}

/** Como {@link decryptField} pero deja pasar `null` y `undefined`. */
export function decryptOptional(
  stored: string | null | undefined,
): string | null | undefined {
  return stored == null ? stored : decryptField(stored);
}
