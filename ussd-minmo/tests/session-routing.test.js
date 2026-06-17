import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, initDb } from '../db.js';
import { formatUssdResponse } from '../menus.js';
import { handleUssdSession } from '../sessions.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

function relayStub(events) {
  return {
    async publish(event) {
      events.push(event);
      return [{ relay: 'stub', ok: true, message: 'accepted' }];
    }
  };
}

async function createContext() {
  const db = await createDatabase(':memory:');
  await initDb(db);
  const events = [];
  return { db, events, relayPublisher: relayStub(events), logger: silentLogger() };
}

async function step(context, text, sessionId = 'session-1', phone = '+254700000123') {
  const result = await handleUssdSession({
    db: context.db,
    relayPublisher: context.relayPublisher,
    sessionId,
    phone,
    text,
    logger: context.logger
  });
  return formatUssdResponse(result);
}

test('routes a new user through registration and publishes Pontmore Agent records', async () => {
  const context = await createContext();

  assert.match(await step(context, ''), /^CON Pontmore Minmo USSD/);
  assert.match(await step(context, '1'), /^CON Enter your full name/);
  assert.match(await step(context, '1*Ada Lovelace'), /^CON Select currency/);
  assert.match(await step(context, '1*Ada Lovelace*1'), /^CON Select payment method/);
  assert.match(await step(context, '1*Ada Lovelace*1*1'), /^CON Enter available float amount/);
  assert.match(await step(context, '1*Ada Lovelace*1*1*15000'), /^CON Confirm registration/);
  assert.match(await step(context, '1*Ada Lovelace*1*1*15000*1'), /^END Registered successfully/);

  const agent = await context.db.get('SELECT * FROM agents WHERE phone = ?', ['+254700000123']);
  assert.equal(agent.name, 'Ada Lovelace');
  assert.equal(context.events.length, 2);
  assert.equal(context.events[0].kind, 30361);
  assert.equal(context.events[1].kind, 30360);
  assert.equal(JSON.parse(context.events[0].content).version, 'PIP-01-draft');
  assert.equal(JSON.parse(context.events[1].content).version, 'PIP-00-draft');
  assert.deepEqual(context.events[1].tags.find((tag) => tag[0] === 'd'), ['d', 'agent']);

  await context.db.close();
});

test('routes a returning user to the home menu and update float flow', async () => {
  const context = await createContext();
  await step(context, '');
  await step(context, '1');
  await step(context, '1*Grace Hopper');
  await step(context, '1*Grace Hopper*1');
  await step(context, '1*Grace Hopper*1*1');
  await step(context, '1*Grace Hopper*1*1*20000');
  await step(context, '1*Grace Hopper*1*1*20000*1');

  assert.match(await step(context, '', 'session-2'), /^CON Pontmore Agent/);
  assert.match(await step(context, '2', 'session-2'), /^CON Enter available float amount/);
  assert.match(await step(context, '2*30000', 'session-2'), /^CON Update float/);
  assert.match(await step(context, '2*30000*1', 'session-2'), /^END Float updated/);

  const agent = await context.db.get('SELECT * FROM agents WHERE phone = ?', ['+254700000123']);
  assert.equal(agent.liquidity, 30000);
  assert.equal(context.events.length, 3);
  assert.equal(context.events.at(-1).kind, 30360);
  assert.equal(JSON.parse(context.events.at(-1).content).version, 'PIP-00-draft');

  await context.db.close();
});

test('routes a swap request action and publishes PIP-02', async () => {
  const context = await createContext();
  await step(context, '');
  await step(context, '1');
  await step(context, '1*Satoshi Agent');
  await step(context, '1*Satoshi Agent*1');
  await step(context, '1*Satoshi Agent*1*1');
  await step(context, '1*Satoshi Agent*1*1*40000');
  await step(context, '1*Satoshi Agent*1*1*40000*1');

  const agent = await context.db.get('SELECT * FROM agents WHERE phone = ?', ['+254700000123']);
  await context.db.run(
    `INSERT INTO swaps
      (swap_id, agent_pubkey, agent_phone, from_currency, fiat_amount, btc_amount_sats, status, payment_reference)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['SWAP-TEST-1', agent.pubkey, agent.phone, 'KES', 3500, 2400, 'pending', 'MPESA-TEST']
  );

  assert.match(await step(context, '', 'session-3'), /^CON Pontmore Agent/);
  assert.match(await step(context, '1', 'session-3'), /^CON Pending swaps/);
  assert.match(await step(context, '1*1', 'session-3'), /^CON Swap SWAP-TEST-1/);
  assert.match(await step(context, '1*1*1', 'session-3'), /^END Payment marked sent/);

  const swap = await context.db.get('SELECT * FROM swaps WHERE swap_id = ?', ['SWAP-TEST-1']);
  const lastEvent = context.events.at(-1);
  assert.equal(swap.status, 'payment_sent');
  assert.equal(lastEvent.kind, 7301);
  assert.equal(JSON.parse(lastEvent.content).pip, 'PIP-02');
  assert.equal(JSON.parse(lastEvent.content).type, 'swap_transition');
  assert.equal(JSON.parse(lastEvent.content).state, 'payment_sent');
  assert.equal(JSON.parse(lastEvent.content).prev_state, 'pending');

  await context.db.close();
});
