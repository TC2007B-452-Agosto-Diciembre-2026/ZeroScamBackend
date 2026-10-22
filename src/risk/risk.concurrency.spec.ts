/* eslint-disable @typescript-eslint/unbound-method */
import { BadRequestException } from '@nestjs/common';
import { checkBlacklist } from './checks/blacklist.check';
import { checkCertificate } from './checks/certificate.check';
import { checkDomainAge } from './checks/domain-age.check';
import { RiskRepository } from './risk.repository';
import { RiskService } from './risk.service';
import { resolveTarget } from './target';
import type { Target } from './target';

// Ninguna prueba toca la red: el DNS y las verificaciones externas se
// simulan. `normalizeUrl` sí es el de verdad.
jest.mock('./target', () => ({
  ...jest.requireActual<typeof import('./target')>('./target'),
  resolveTarget: jest.fn(),
}));
jest.mock('./checks/certificate.check');
jest.mock('./checks/domain-age.check');
jest.mock('./checks/blacklist.check');
const resolveTargetMock = jest.mocked(resolveTarget);

const flush = () => new Promise((resolve) => setImmediate(resolve));

function targetOf(url: string): Target {
  const parsed = new URL(url);
  return {
    url: parsed.toString(),
    hostname: parsed.hostname,
    protocol: 'https',
    port: 443,
    address: '93.184.216.34',
  } as unknown as Target;
}

/** `resolveTarget` que no contesta hasta que se llame a `release`. */
function hold() {
  const waiting: (() => void)[] = [];
  resolveTargetMock.mockImplementation(
    (url: string) =>
      new Promise<Target>((resolve) => {
        waiting.push(() => resolve(targetOf(url)));
      }),
  );
  return () => waiting.splice(0).forEach((release) => release());
}

describe('RiskService: análisis simultáneos (RNF01)', () => {
  let repository: jest.Mocked<RiskRepository>;
  let service: RiskService;

  beforeEach(() => {
    resolveTargetMock.mockReset();
    jest.mocked(checkCertificate).mockResolvedValue({
      name: 'certificate',
      passed: true,
      detail: 'ok',
      points: 0,
      status: 'VALIDO',
    });
    jest.mocked(checkDomainAge).mockResolvedValue({
      name: 'domainAge',
      passed: true,
      detail: 'ok',
      points: 0,
    });
    jest.mocked(checkBlacklist).mockResolvedValue({
      name: 'blacklist',
      passed: true,
      detail: 'ok',
      points: 0,
    });
    repository = {
      findEvaluation: jest.fn().mockResolvedValue(undefined),
      findValidatedReportsByHost: jest.fn().mockResolvedValue([]),
      findRiskLevel: jest.fn().mockResolvedValue(undefined),
      saveEvaluation: jest.fn(),
      recordLookup: jest.fn(),
      alertRecentUsers: jest.fn(),
    } as unknown as jest.Mocked<RiskRepository>;
    service = new RiskService(repository);
  });

  it('muchas personas con el mismo enlace nuevo comparten una sola consulta externa', async () => {
    const release = hold();
    const calls = Array.from({ length: 30 }, (_, i) =>
      service.analyze('https://ejemplo.com/login', String(i)),
    );
    await flush();
    expect(resolveTargetMock).toHaveBeenCalledTimes(1);

    release();
    const results = await Promise.all(calls);
    expect(results).toHaveLength(30);
    expect(resolveTargetMock).toHaveBeenCalledTimes(1);
    expect(checkDomainAge).toHaveBeenCalledTimes(1);
    // Cada persona deja anotada su consulta (RF08).
    expect(repository.recordLookup).toHaveBeenCalledTimes(30);
  });

  it('enlaces distintos no comparten el trabajo', async () => {
    const release = hold();
    const calls = ['a', 'b', 'c'].map((path, i) =>
      service.analyze(`https://ejemplo.com/${path}`, String(i)),
    );
    await flush();
    expect(resolveTargetMock).toHaveBeenCalledTimes(3);
    release();
    await Promise.all(calls);
  });

  it('si la consulta compartida falla, todos reciben el mismo error', async () => {
    resolveTargetMock.mockRejectedValue(new BadRequestException('interna'));
    const calls = Array.from({ length: 5 }, (_, i) =>
      service.analyze('https://ejemplo.com/login', String(i)),
    );
    for (const call of calls) {
      await expect(call).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(resolveTargetMock).toHaveBeenCalledTimes(1);
  });

  it('después de terminar, un enlace nuevo vuelve a consultarse', async () => {
    resolveTargetMock.mockImplementation((url: string) =>
      Promise.resolve(targetOf(url)),
    );
    await service.analyze('https://ejemplo.com/login', '1');
    await service.analyze('https://ejemplo.com/login', '2');
    // El caché de la base está simulado como vacío: cada llamada sin otra en
    // curso hace su propia consulta.
    expect(resolveTargetMock).toHaveBeenCalledTimes(2);
  });
});
