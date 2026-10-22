import { HealthWatchdog } from './watchdog';

describe('HealthWatchdog (RNF05)', () => {
  function setup(failuresToAlert = 3) {
    let up = true;
    let clock = new Date('2026-10-21T20:00:00.000Z');
    const notify = jest.fn().mockResolvedValue(undefined);
    const watchdog = new HealthWatchdog({
      check: () =>
        up ? Promise.resolve(true) : Promise.reject(new Error('caído')),
      notify,
      failuresToAlert,
      now: () => clock,
    });
    return {
      watchdog,
      notify,
      setUp: (value: boolean) => (up = value),
      advance: (minutes: number) =>
        (clock = new Date(clock.getTime() + minutes * 60_000)),
    };
  }

  it('no avisa mientras el servicio responde', async () => {
    const { watchdog, notify } = setup();
    for (let i = 0; i < 5; i++) await watchdog.tick();
    expect(notify).not.toHaveBeenCalled();
    expect(watchdog.availability()).toMatchObject({
      checks: 5,
      ok: 5,
      percent: 100,
      down: false,
    });
  });

  it('un tropiezo suelto no avisa', async () => {
    const { watchdog, notify, setUp } = setup();
    setUp(false);
    await watchdog.tick();
    await watchdog.tick();
    setUp(true);
    await watchdog.tick();
    expect(notify).not.toHaveBeenCalled();
  });

  it('avisa una sola vez al llegar al umbral de fallas seguidas', async () => {
    const { watchdog, notify, setUp } = setup();
    setUp(false);
    for (let i = 0; i < 6; i++) await watchdog.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'ZeroScam: el servicio no responde',
      expect.stringContaining('2026-10-21T20:00:00.000Z'),
    );
  });

  it('avisa cuando vuelve y dice cuánto estuvo caído', async () => {
    const { watchdog, notify, setUp, advance } = setup();
    setUp(false);
    for (let i = 0; i < 3; i++) await watchdog.tick();
    advance(7);
    setUp(true);
    await watchdog.tick();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(
      'ZeroScam: el servicio volvió',
      expect.stringContaining('unos 7 min'),
    );
    expect(watchdog.availability().down).toBe(false);
  });

  it('después de recuperarse, una nueva caída vuelve a avisar', async () => {
    const { watchdog, notify, setUp } = setup(2);
    setUp(false);
    await watchdog.tick();
    await watchdog.tick();
    setUp(true);
    await watchdog.tick();
    setUp(false);
    await watchdog.tick();
    await watchdog.tick();
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it('dos consultas encimadas no repiten el aviso de recuperación', async () => {
    const { watchdog, notify, setUp } = setup(1);
    setUp(false);
    await watchdog.tick();
    setUp(true);
    // El aviso tarda: mientras tanto llega la siguiente consulta.
    notify.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 20)),
    );
    await Promise.all([watchdog.tick(), watchdog.tick()]);
    expect(notify).toHaveBeenCalledTimes(2); // 1 de caída + 1 de recuperación
  });

  it('si el aviso falla, el vigilante sigue funcionando', async () => {
    const { watchdog, notify, setUp } = setup(1);
    notify.mockRejectedValue(new Error('SMTP caído'));
    setUp(false);
    await expect(watchdog.tick()).resolves.toBeUndefined();
    expect(watchdog.availability().down).toBe(true);
  });

  it('calcula el porcentaje de disponibilidad', async () => {
    const { watchdog, setUp } = setup(100);
    for (let i = 0; i < 99; i++) await watchdog.tick();
    setUp(false);
    await watchdog.tick();
    expect(watchdog.availability()).toMatchObject({
      checks: 100,
      ok: 99,
      percent: 99,
    });
  });
});
