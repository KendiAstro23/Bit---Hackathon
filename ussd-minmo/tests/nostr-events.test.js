import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeypair, signEvent, verifySignedEvent } from '../nostr.js';
import {
  PONTMORE_KINDS,
  buildPontmoreAgentDefinitionEvent,
  buildPontmoreAgentRecord,
  buildPontmoreDisputeEvent,
  buildPontmoreEscrowDescriptorEvent,
  buildPontmoreSwapTransitionEvent,
  verifyPontmoreSignedEvent
} from '../protocol/pontmore.js';

test('creates a signed PIP-00 Agent definition event', () => {
  const keypair = createKeypair();
  const unsigned = buildPontmoreAgentDefinitionEvent({
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
  assert.equal(verifyPontmoreSignedEvent(event), true);
  assert.equal(event.kind, 30360);
  assert.equal(content.version, 'PIP-00-draft');
  assert.deepEqual(event.tags.find((tag) => tag[0] === 'd'), ['d', 'agent']);
  assert.deepEqual(event.tags.find((tag) => tag[0] === 't'), ['t', 'agent']);
  assert.deepEqual(event.tags.find((tag) => tag[0] === 'f'), ['f', 'KES']);
  assert.deepEqual(event.tags.find((tag) => tag[0] === 'a'), ['a', `30361:${keypair.pubkey}:escrow`]);
  assert.deepEqual(content.capabilities.swap_types, ['fiat-to-btc', 'btc-to-fiat']);
  assert.deepEqual(content.capabilities.payment_channels, ['mpesa']);
  assert.deepEqual(content.capabilities.access_channels, ['ussd']);
  assert.equal(content.escrow.descriptor, `30361:${keypair.pubkey}:escrow`);
  assert.equal(JSON.stringify(content).includes('+254700000001'), false);
});

test('wraps a signed Agent event like the Pontmore POC Agent record', () => {
  const keypair = createKeypair();
  const unsigned = buildPontmoreAgentDefinitionEvent({
    name: 'Example USSD Agent',
    pubkey: keypair.pubkey,
    currency: 'KES',
    payment_method: 'M-PESA',
    liquidity: 50000
  });
  const event = signEvent(unsigned, keypair.privkey);
  const record = buildPontmoreAgentRecord(event);

  assert.equal(record.coordinate, `${PONTMORE_KINDS.agentDefinition}:${keypair.pubkey}:agent`);
  assert.match(record.npub, /^npub1/);
  assert.equal(record.identifier, 'agent');
  assert.equal(record.content.name, 'Example USSD Agent');
  assert.equal(record.content.escrow.descriptor, `${PONTMORE_KINDS.escrowDescriptor}:${keypair.pubkey}:escrow`);
  assert.equal(record.event.id, event.id);
});

test('creates a signed PIP-01 escrow descriptor event', () => {
  const keypair = createKeypair();
  const agent = { pubkey: keypair.pubkey, privkey: keypair.privkey };
  const unsigned = buildPontmoreEscrowDescriptorEvent(agent);
  const event = signEvent(unsigned, keypair.privkey);
  const content = JSON.parse(event.content);

  assert.equal(verifyPontmoreSignedEvent(event), true);
  assert.equal(content.version, 'PIP-01-draft');
  assert.equal(content.descriptor, `30361:${keypair.pubkey}:escrow`);
  assert.equal(content.escrow_type, 'custodial_escrow');
  assert.deepEqual(content.networks, ['bitcoin', 'lightning']);
  assert.equal(content.dispute_rules.policy, 'operator_resolved');
  assert.equal(content.reference_format, 'operator_escrow_reference');
  assert.deepEqual(event.tags.find((tag) => tag[0] === 'd'), ['d', 'escrow']);
  assert.deepEqual(event.tags.find((tag) => tag[0] === 'a'), ['a', `30360:${keypair.pubkey}:agent`]);
  assert.deepEqual(event.tags.filter((tag) => tag[0] === 'network'), [
    ['network', 'bitcoin'],
    ['network', 'lightning']
  ]);
});

test('creates a signed PIP-02 swap transition event', () => {
  const keypair = createKeypair();
  const agent = { pubkey: keypair.pubkey, privkey: keypair.privkey };
  const swap = { swap_id: 'SWAP-1', status: 'pending' };
  const unsigned = buildPontmoreSwapTransitionEvent({
    agent,
    swap,
    action: 'mark_payment_sent',
    nextState: 'payment_sent'
  });

  const event = signEvent(unsigned, keypair.privkey);
  const content = JSON.parse(event.content);

  assert.equal(verifySignedEvent(event), true);
  assert.equal(verifyPontmoreSignedEvent(event), true);
  assert.equal(event.kind, 7301);
  assert.equal(content.pip, 'PIP-02');
  assert.equal(content.type, 'swap_transition');
  assert.equal(content.state, 'payment_sent');
  assert.equal(content.prev_state, 'pending');
  assert.equal(content.actor_role, 'agent');
  assert.equal(content.reason, 'mark_payment_sent');
  assert.equal(content.next_state, 'payment_sent');
  assert.deepEqual(event.tags.find((tag) => tag[0] === 'swap'), ['swap', 'SWAP-1']);
});

test('creates a signed PIP-02 dispute event with PIP-03 policy', () => {
  const keypair = createKeypair();
  const agent = { pubkey: keypair.pubkey, privkey: keypair.privkey };
  const swap = { swap_id: 'SWAP-2', status: 'payment_sent' };
  const unsigned = buildPontmoreDisputeEvent({ agent, swap, reason: 'payment_dispute' });
  const event = signEvent(unsigned, keypair.privkey);
  const content = JSON.parse(event.content);

  assert.equal(verifyPontmoreSignedEvent(event), true);
  assert.equal(event.kind, 7303);
  assert.equal(content.type, 'swap_dispute');
  assert.equal(content.state, 'disputed');
  assert.equal(content.prev_state, 'payment_sent');
  assert.equal(content.actor_role, 'agent');
  assert.equal(content.dispute_policy.pip, 'PIP-03');
  assert.deepEqual(event.tags.find((tag) => tag[0] === 'dispute_class'), ['dispute_class', 'payment_dispute']);
});

test('rejects Pontmore events that leak private operator fields', () => {
  const keypair = createKeypair();
  const unsigned = buildPontmoreAgentDefinitionEvent({
    name: 'Private Leak',
    pubkey: keypair.pubkey,
    currency: 'KES',
    payment_method: 'M-PESA',
    liquidity: 10000
  });
  const content = JSON.parse(unsigned.content);
  content.phone = '+254700000001';
  const event = signEvent({ ...unsigned, content: JSON.stringify(content) }, keypair.privkey);

  assert.throws(() => verifyPontmoreSignedEvent(event), /private operator data/);
});
