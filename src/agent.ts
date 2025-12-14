import { generateText, CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { PlayerConfig } from './types.js';
import { logger } from './logger.js';
import * as dotenv from 'dotenv';

dotenv.config();

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_GATEWAY_URL, // Optional: Vercel AI Gateway URL
});

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
      // Allow overriding the model if needed, default to what's in config
      // Note: In a real app we might want to support other providers
      logger.log({
        type: 'SYSTEM',
        content: `Initializing model for ${this.config.name}: ${this.config.model}`
      });
      const model = openai(this.config.model);

      const systemPrompt = `
        ${systemContext}
        
        Your Name: ${this.config.name}
        Your Persona: ${this.config.systemPrompt || 'You are helpful and concise.'}
      `;

      // Ensure messages is not empty
      const messages = history.length > 0 ? history : [{ role: 'user', content: 'Please proceed with the game.' }];

      const result = await generateText({
        model,
        system: systemPrompt,
        messages: messages as any, // Cast to avoid strict type issues with simplified objects
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
      const model = openai(this.config.model);
      const systemPrompt = `
        ${context}
        
        Your Name: ${this.config.name}
        Role: ${this.role}
        
        You must choose exactly one option from the list below.
        Options: ${JSON.stringify(options)}
        
        Return ONLY the option name.
      `;

      // Ensure messages is not empty
      const messages = history.length > 0 ? history : [{ role: 'user', content: 'Please make a decision.' }];

      const result = await generateText({
        model,
        system: systemPrompt,
        messages: messages as any,
        temperature: 0.2, // Lower temp for decisions
      });

      const choice = result.text.trim();
      // Simple validation
      const matched = options.find(o => choice.includes(o));
      return matched || options[0]; // Fallback to first option if invalid
    } catch (error) {
       logger.log({
        type: 'SYSTEM',
        content: `Error generating decision for ${this.config.name}: ${(error as Error).message}`,
        metadata: { error }
      });
      return options[0];
    }
  }
}
