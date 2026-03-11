import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelMessage as CoreMessage } from 'ai';
import { AgentIO, type AgentLike } from '../agentIo.js';
import type { ResponseScope } from '../agent.js';

function createStubAgent(calls: ResponseScope[]): AgentLike {
  return {
    async generateResponse(
      _context: string,
      _history: CoreMessage[],
      scope: ResponseScope
    ): Promise<string> {
      calls.push(scope);
      return scope === 'public' ? 'public reply' : 'faction reply';
    },
    async generateDecision(context: string, options: string[]): Promise<string> {
      void context;
      return options[0] ?? '';
    },
    async generateRawResponse(): Promise<string> {
      return '';
    },
    async generateReflection(): Promise<string> {
      return 'reflection';
    },
  };
}

test('AgentIO respondPublic and respondFaction dispatch distinct scopes', async () => {
  const calls: ResponseScope[] = [];
  const agentIO = new AgentIO({
    Alice: createStubAgent(calls),
  });

  const publicReply = await agentIO.respondPublic('Alice', 'Day chat context', []);
  const factionReply = await agentIO.respondFaction('Alice', 'Night faction context', []);

  assert.equal(publicReply, 'public reply');
  assert.equal(factionReply, 'faction reply');
  assert.deepEqual(calls, ['public', 'faction']);
});
