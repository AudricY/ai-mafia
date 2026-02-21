import type { CoreMessage } from 'ai';
import { randomInt } from 'node:crypto';
import { logger } from './logger.js';
import type { Agent } from './agent.js';
import type { GameLogEntry } from './types.js';
import { isDryRun } from './utils.js';

export interface AgentIOConfig {
  responseTimeoutMs: number;
  decisionTimeoutMs: number;
  maxAttempts: number;
  retryBackoffMs: number;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shuffleInPlace<T>(arr: T[]): void {
  // Fisher–Yates shuffle.
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

function withAbortableTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const promise = fn(controller.signal);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => {
        controller.abort();
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (t) clearTimeout(t);
  });
}

function pickSafeFallback(options: readonly string[]): string {
  const lowered = new Map(options.map(o => [o.toLowerCase(), o] as const));
  return lowered.get('skip') ?? lowered.get('nobody') ?? options[0] ?? '';
}

export class AgentIO {
  private agents: Record<string, Agent>;
  private cfg: AgentIOConfig;

  constructor(
    agents: Record<string, Agent>,
    cfg?: Partial<AgentIOConfig>
  ) {
    this.agents = agents;
    this.cfg = {
      responseTimeoutMs: cfg?.responseTimeoutMs ?? 90_000,
      decisionTimeoutMs: cfg?.decisionTimeoutMs ?? 60_000,
      maxAttempts: cfg?.maxAttempts ?? 2,
      retryBackoffMs: cfg?.retryBackoffMs ?? 1500,
    };
  }

  async respond(actor: string, context: string, history: CoreMessage[] = []): Promise<string> {
    const agent = this.agents[actor];
    if (!agent) return 'SKIP';

    const attemptMetaBase = { actor, kind: 'response' } as const;

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.cfg.maxAttempts; attempt++) {
      try {
        const text = await withAbortableTimeout(
          (signal) => agent.generateResponse(context, history, signal),
          this.cfg.responseTimeoutMs
        );
        const trimmed = text.trim();
        if (trimmed) return trimmed;
        lastError = new Error('Empty response');
      } catch (err) {
        lastError = err;
      }

      logger.log({
        type: 'SYSTEM',
        content: `AgentIO: ${actor} response failed (attempt ${attempt}/${this.cfg.maxAttempts}): ${String((lastError as Error)?.message ?? lastError)}`,
        metadata: { ...attemptMetaBase, attempt, visibility: 'private' } satisfies GameLogEntry['metadata'],
      });

      if (attempt < this.cfg.maxAttempts) {
        await delay(this.cfg.retryBackoffMs * attempt);
      }
    }

    // Safe public fallback in discussion phases is SKIP.
    return 'SKIP';
  }

  async decide<T extends string>(
    actor: string,
    context: string,
    options: readonly T[],
    history: CoreMessage[] = [],
    systemAddendum?: string
  ): Promise<T> {
    const agent = this.agents[actor];
    if (!agent) return pickSafeFallback(options) as T;
    if (options.length === 0) return '' as T;

    const attemptMetaBase = { actor, kind: 'decision' } as const;
    const optionsArray = [...options];
    // Avoid stable option-order bias for low-temperature "pick one" decisions.
    // Keep dry-run deterministic/repeatable by preserving the original order.
    if (!isDryRun() && optionsArray.length > 1) shuffleInPlace(optionsArray);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.cfg.maxAttempts; attempt++) {
      try {
        const choice = await withAbortableTimeout(
          (signal) => agent.generateDecision(context, optionsArray, history, systemAddendum, signal),
          this.cfg.decisionTimeoutMs
        );
        const matched =
          options.find(o => o === choice) ??
          options.find(o => o.toLowerCase() === choice.trim().toLowerCase());
        if (matched) return matched;
        lastError = new Error(`Invalid choice "${choice}"`);
      } catch (err) {
        lastError = err;
      }

      logger.log({
        type: 'SYSTEM',
        content: `AgentIO: ${actor} decision failed (attempt ${attempt}/${this.cfg.maxAttempts}): ${String((lastError as Error)?.message ?? lastError)}`,
        metadata: { ...attemptMetaBase, attempt, visibility: 'private' } satisfies GameLogEntry['metadata'],
      });

      if (attempt < this.cfg.maxAttempts) {
        await delay(this.cfg.retryBackoffMs * attempt);
      }
    }

    return pickSafeFallback(options) as T;
  }

  async reflect(actor: string, context: string): Promise<string> {
    const agent = this.agents[actor];
    if (!agent) return 'No reflections.';

    const attemptMetaBase = { actor, kind: 'reflection' } as const;

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.cfg.maxAttempts; attempt++) {
      try {
        const text = await withAbortableTimeout(
          (signal) => agent.generateReflection(context, signal),
          this.cfg.responseTimeoutMs
        );
        const trimmed = text.trim();
        if (trimmed) return trimmed;
        lastError = new Error('Empty response');
      } catch (err) {
        lastError = err;
      }

      logger.log({
        type: 'SYSTEM',
        content: `AgentIO: ${actor} reflection failed (attempt ${attempt}/${this.cfg.maxAttempts}): ${String((lastError as Error)?.message ?? lastError)}`,
        metadata: { ...attemptMetaBase, attempt, visibility: 'private' } satisfies GameLogEntry['metadata'],
      });

      if (attempt < this.cfg.maxAttempts) {
        await delay(this.cfg.retryBackoffMs * attempt);
      }
    }

    return 'No reflections.';
  }
}


