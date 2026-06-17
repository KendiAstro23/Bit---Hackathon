import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMip02AgentEvent } from '../mip02.js';
import { buildMip04TransitionEvent } from '../mip04.js';
import { createKeypair, signEvent, verifySignedEvent } from '../nostr.js';

test('creates a signed MIP-02 agent event', () => {
  const keypair = createKeypair();
  const unsigned = buildMip02AgentEvent({
    phone: '+254700000001',
    name: 'Test Agent',
    pubkey: keypair.pubkey,
    currency: 'KES',
    payment_method: 'M-PESA',
    liquidity: 10000
  });

  const event = signEvent(unsigned, keypair.privkey);
  const content = JSON.parse(event.content);

  assert.equal(verifySignedEvent(event), true);
  assert.equal(content.mip, 'MIP-02');
  assert.equal(content.type, 'agent_profile');
  assert.deepEqual(event.tags.find((tag) => tag[0] === 'currency'), ['currency', 'KES']);
});

test('creates a signed MIP-04 swap transition event', () => {
  const keypair = createKeypair();
  const agent = { pubkey: keypair.pubkey, privkey: keypair.privkey };
  const swap = { swap_id: 'SWAP-1', status: 'pending' };
  const unsigned = buildMip04TransitionEvent({
    agent,
    swap,
    action: 'mark_payment_sent',
    nextState: 'payment_sent'
  });

  const event = signEvent(unsigned, keypair.privkey);
  const content = JSON.parse(event.content);

  assert.equal(verifySignedEvent(event), true);
  assert.equal(content.mip, 'MIP-04');
  assert.equal(content.next_state, 'payment_sent');
  assert.deepEqual(event.tags.find((tag) => tag[0] === 'swap'), ['swap', 'SWAP-1']);
});
