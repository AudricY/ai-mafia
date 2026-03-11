import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelMessage as CoreMessage } from 'ai';
import { Agent, createFactionMemory, type ResponseScope } from '../agent.js';

function readStringContent(message: CoreMessage | undefined): string {
  assert.ok(message, 'expected a message');
  if (typeof message.content !== 'string') {
    assert.fail('expected string message content');
  }
  return message.content;
}

function makeAgentWithMemory() {
  const factionMemory = createFactionMemory('mafia');
  factionMemory.sharedSummary = 'Our team suspects Frank is the doctor.';

  const agent = new Agent(
    { name: 'Alice', model: 'zai/glm-5', temperature: 0.7 },
    {
      gameRules: 'You are playing Mafia.',
      role: 'mafia',
      factionMemory,
    }
  );

  agent.observePublicEvent({
    id: '1',
    timestamp: new Date('2026-03-11T00:00:00Z').toISOString(),
    type: 'CHAT',
    player: 'Bob',
    content: 'I think Charlie is suspicious.',
    metadata: { visibility: 'public' },
  });
  agent.observePrivateEvent('Investigation result: Frank is NOT MAFIA.');
  agent.observeFactionEvent('Night chat: Block Frank tonight.');

  return agent;
}

function buildScopedMessages(agent: Agent, scope: 'public' | 'private'): CoreMessage[] {
  const internalAgent = agent as unknown as {
    buildMemoryUserMessage(
      scope: 'public' | 'private',
      situationalContext: string,
      decisionConstraints?: string
    ): CoreMessage[];
  };

  return internalAgent.buildMemoryUserMessage(scope, 'Current Phase: Test.', 'Now produce your response.');
}

function buildScopedPrompt(agent: Agent, scope: ResponseScope): string {
  const internalAgent = agent as unknown as {
    buildResponseSystemPrompt(scope: ResponseScope, systemConstraints?: string): string;
  };

  return internalAgent.buildResponseSystemPrompt(scope, 'Output something.');
}

test('public response memory includes notebook but excludes faction memory', () => {
  const agent = makeAgentWithMemory();
  const messages = buildScopedMessages(agent, 'public');
  const memoryBlock = readStringContent(messages[0]);

  assert.match(memoryBlock, /Private notebook \(tail\):/);
  assert.match(memoryBlock, /Frank is NOT MAFIA/);
  assert.match(memoryBlock, /Public recent events:/);
  assert.doesNotMatch(memoryBlock, /Faction shared summary:/);
  assert.doesNotMatch(memoryBlock, /Faction recent events:/);
  assert.doesNotMatch(memoryBlock, /Block Frank tonight/);
});

test('private response memory keeps faction summary and faction recent events', () => {
  const agent = makeAgentWithMemory();
  const messages = buildScopedMessages(agent, 'private');
  const memoryBlock = readStringContent(messages[0]);

  assert.match(memoryBlock, /Faction shared summary:/);
  assert.match(memoryBlock, /Our team suspects Frank is the doctor/);
  assert.match(memoryBlock, /Faction recent events:/);
  assert.match(memoryBlock, /Block Frank tonight/);
});

test('public response prompt includes evidence-discipline hardening', () => {
  const agent = makeAgentWithMemory();
  const prompt = buildScopedPrompt(agent, 'public');

  assert.match(prompt, /Public speaking rules:/);
  assert.match(prompt, /Treat private notebook content as strategy guidance, not as public evidence\./);
  assert.match(prompt, /Never present private night-action outcomes, faction-only coordination, or hidden-role knowledge as public fact\./);
  assert.match(prompt, /Any factual claim in public speech must be supported by the public ledger or public recent events; otherwise label it as speculation or a hunch\./);
  assert.match(prompt, /If you have private information that materially changes today's best elimination or prevents a likely miselimination, prefer revealing it over staying vague\./);
});

test('faction response prompt does not inject public-only evidence discipline block', () => {
  const agent = makeAgentWithMemory();
  const prompt = buildScopedPrompt(agent, 'faction');

  assert.doesNotMatch(prompt, /Public speaking rules:/);
});
