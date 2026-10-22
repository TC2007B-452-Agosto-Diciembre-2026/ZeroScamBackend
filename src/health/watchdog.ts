/**
 * Vigilante de disponibilidad (RNF05): consulta `/health` cada cierto tiempo y
 * avisa al equipo cuando el servicio deja de contestar y cuando vuelve.
 *
 * Aquí está solo la lógica; `scripts/vigilar-salud.mjs` la conecta con
 * `fetch` y el correo (Mailpit), y corre como un contenedor aparte
 * (`monitor` en `deploy/back/docker-compose.yml`).
 */
export interface WatchdogOptions {
  /** Regresa `true` si el servicio contestó bien. */
  check: () => Promise<boolean>;
  /** Manda el aviso (correo a Mailpit). Un error aquí no detiene al vigilante. */
  notify: (subject: string, body: string) => Promise<void>;
  /** Fallas seguidas para avisar; evita avisar por un solo tropiezo. */
  failuresToAlert?: number;
  now?: () => Date;
}

/** Lo que se sabe de la disponibilidad desde que arrancó el vigilante. */
export interface Availability {
  checks: number;
  ok: number;
  /** Porcentaje de consultas correctas, con dos decimales. */
  percent: number;
  down: boolean;
}

export class HealthWatchdog {
  private readonly threshold: number;
  private readonly now: () => Date;
  private failures = 0;
  private alerted = false;
  private downSince: Date | undefined;
  private checks = 0;
  private ok = 0;
  /** Evita que dos consultas se pisen si un aviso o una respuesta tarda más que el intervalo. */
  private busy = false;

  constructor(private readonly options: WatchdogOptions) {
    this.threshold = options.failuresToAlert ?? 3;
    this.now = options.now ?? (() => new Date());
  }

  /** Una consulta: actualiza el estado y avisa si cambió. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const up = await this.options.check().catch(() => false);
      this.checks++;
      if (up) {
        this.ok++;
        // El estado se limpia antes de avisar, para que un aviso lento no se repita.
        const wasDown = this.alerted;
        const since = this.downSince;
        this.failures = 0;
        this.alerted = false;
        this.downSince = undefined;
        if (wasDown && since) await this.sendRecovery(since);
        return;
      }
      if (this.failures === 0) this.downSince = this.now();
      this.failures++;
      if (!this.alerted && this.failures >= this.threshold) {
        this.alerted = true;
        await this.safeNotify(
          'ZeroScam: el servicio no responde',
          `La API no contesta desde ${this.downSince!.toISOString()} ` +
            `(${this.failures} consultas seguidas fallaron).`,
        );
      }
    } finally {
      this.busy = false;
    }
  }

  availability(): Availability {
    return {
      checks: this.checks,
      ok: this.ok,
      percent:
        this.checks === 0
          ? 100
          : Math.round((this.ok / this.checks) * 10_000) / 100,
      down: this.failures > 0,
    };
  }

  private async sendRecovery(since: Date): Promise<void> {
    const minutes = Math.max(
      0,
      Math.round((this.now().getTime() - since.getTime()) / 60_000),
    );
    await this.safeNotify(
      'ZeroScam: el servicio volvió',
      `La API volvió a responder. Estuvo sin responder unos ${minutes} min ` +
        `(desde ${since.toISOString()}).`,
    );
  }

  private async safeNotify(subject: string, body: string): Promise<void> {
    try {
      await this.options.notify(subject, body);
    } catch {
      // Si el aviso falla se vuelve a intentar con el siguiente cambio de estado.
    }
  }
}
