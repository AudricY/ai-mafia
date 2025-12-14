import { generateText, CoreMessage, gateway } from 'ai';
import { PlayerConfig } from './types.js';
import { logger } from './logger.js';

export class Agent {
  private config: PlayerConfig;

  constructor(config: PlayerConfig) {
    this.config = config;
  }

  get name() {
    return this.config.name;
  }

  get role() {
    // Role is managed by GameState, but agent might "know" it
    return 'unknown'; 
  }

  async generateResponse(
    systemContext: string,
    history: CoreMessage[]
  ): Promise<string> {
    try {
      logger.log({
        type: 'SYSTEM',
        content: `Initializing model for ${this.config.name}: ${this.config.model}`
      });

      const modelId = this.normalizeModelId(this.config.model);
      const model = gateway(modelId);

      const systemPrompt = `
        ${systemContext}
        
        Your Name: ${this.config.name}
        Your Persona: ${this.config.systemPrompt || 'You are helpful and concise.'}
      `;

      // Ensure messages is not empty
      const messages: CoreMessage[] =
        history.length > 0
          ? history
          : [{ role: 'user', content: 'Please proceed with the game.' }];

      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        temperature: this.config.temperature,
      });

      return result.text;
    } catch (error) {
      logger.log({
        type: 'SYSTEM',
        content: `Error generating response for ${this.config.name}: ${(error as Error).message}`,
        metadata: { error }
      });
      return "..."; // Fallback silence
    }
  }

  async generateDecision(
    context: string,
    options: string[],
    history: CoreMessage[] = []
  ): Promise<string> {
    try {
      const modelId = this.normalizeModelId(this.config.model);
      const model = gateway(modelId);
      const systemPrompt = `
        ${context}
        
        Your Name: ${this.config.name}
        Role: ${this.role}
        
        You must choose exactly one option from the list below.
        Options: ${JSON.stringify(options)}
        
        Return ONLY the option name.
      `;

      // Ensure messages is not empty
      const messages: CoreMessage[] =
        history.length > 0 ? history : [{ role: 'user', content: 'Please make a decision.' }];

      const result = await generateText({
        model,
        system: systemPrompt,
        messages,
        temperature: 0.2, // Lower temp for decisions
      });

      const choice = result.text.trim();
      const matched = this.matchOption(choice, options);
      return matched ?? options[0];
    } catch (error) {
       logger.log({
        type: 'SYSTEM',
        content: `Error generating decision for ${this.config.name}: ${(error as Error).message}`,
        metadata: { error }
      });
      return options[0];
    }
  }

  private matchOption(choice: string, options: string[]): string | undefined {
    const normalized = choice.replace(/^["'`]+|["'`]+$/g, '').trim().toLowerCase();

    // Exact match (case-insensitive).
    const exact = options.find(o => o.toLowerCase() === normalized);
    if (exact) return exact;

    // Fallback: substring match (e.g. "I vote for Alice" -> "Alice").
    const substring = options.find(o => normalized.includes(o.toLowerCase()));
    return substring;
  }

  private normalizeModelId(modelId: string): string {
    // AI Gateway expects `provider/model` (e.g. `openai/gpt-5`, `anthropic/claude-sonnet-4.5`).
    // Fail fast so config issues are obvious.
    if (!modelId.includes('/')) {
      throw new Error(
        `Invalid model id "${modelId}". Use AI Gateway format "provider/model" (e.g. "openai/gpt-4o").`
      );
    }
    return modelId;
  }
}
