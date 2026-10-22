import {
  decryptField,
  decryptOptional,
  encryptField,
  encryptOptional,
} from './field-crypto';

describe('field-crypto (RNF02)', () => {
  const text = 'Me llamaron del banco y les di mi NIP: 4821';

  it('cifra y descifra un texto con acentos y emojis', () => {
    const plain = 'Número de tarjeta 4111 — año 2026 ñ 🙂';
    expect(decryptField(encryptField(plain))).toBe(plain);
  });

  it('lo guardado no contiene el texto original y lleva la marca', () => {
    const stored = encryptField(text);
    expect(stored.startsWith('enc1:')).toBe(true);
    expect(stored).not.toContain('NIP');
    expect(
      Buffer.from(stored.slice(5), 'base64').toString('utf8'),
    ).not.toContain('banco');
  });

  it('el mismo texto da un resultado distinto cada vez (IV aleatoria)', () => {
    expect(encryptField(text)).not.toBe(encryptField(text));
  });

  it('un valor sin la marca es de antes del cifrado y se regresa igual', () => {
    expect(decryptField('texto viejo sin cifrar')).toBe(
      'texto viejo sin cifrar',
    );
  });

  it('detecta un valor alterado', () => {
    const stored = encryptField(text);
    const raw = Buffer.from(stored.slice(5), 'base64');
    raw[raw.length - 1] ^= 1;
    expect(() => decryptField('enc1:' + raw.toString('base64'))).toThrow();
  });

  it('rechaza un valor cifrado incompleto', () => {
    expect(() => decryptField('enc1:AAAA')).toThrow('incompleto');
  });

  it('deja pasar null y undefined', () => {
    expect(encryptOptional(null)).toBeNull();
    expect(encryptOptional(undefined)).toBeUndefined();
    expect(decryptOptional(null)).toBeNull();
    expect(decryptOptional(undefined)).toBeUndefined();
    expect(decryptOptional(encryptOptional('x'))).toBe('x');
  });
});
