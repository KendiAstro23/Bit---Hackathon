import { recordPublishedEvent } from '../db.js';
import { buildMip02AgentEvent } from '../mip02.js';
import { createKeypair, signEvent } from '../nostr.js';

export const CURRENCIES = ['KES', 'NGN', 'UGX', 'TZS', 'USD'];
export const PAYMENT_METHODS = ['M-PESA', 'Bank Transfer', 'Airtel Money', 'Mobile Money'];

export function normalizePhone(phone) {
  return String(phone || '').replace(/\s+/g, '');
}

export function validateName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 80) throw new Error('Enter a valid full name.');
  if (!/^[a-zA-Z .'-]+$/.test(value)) throw new Error('Name can only include letters, spaces, dots, apostrophes, and hyphens.');
  return value;
}

export function validateLiquidity(value) {
  const normalized = String(value || '').replace(/,/g, '').trim();
  if (!/^\d+$/.test(normalized)) throw new Error('Enter liquidity as a whole number.');
  const amount = Number(normalized);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Liquidity must be greater than zero.');
  return amount;
}

export function selectByMenuIndex(options, input, label) {
  const index = Number(input);
  if (!Number.isInteger(index) || index < 1 || index > options.length) {
    throw new Error(`Select a valid ${label}.`);
  }
  return options[index - 1];
}

export async function findAgentByPhone(db, phone) {
  return db.get('SELECT * FROM agents WHERE phone = ?', [normalizePhone(phone)]);
}

export async function createAgent(db, { phone, name, currency, payment_method, liquidity }) {
  const keypair = createKeypair();
  await db.run(
    `INSERT INTO agents (phone, name, pubkey, privkey, currency, payment_method, liquidity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [normalizePhone(phone), name, keypair.pubkey, keypair.privkey, currency, payment_method, liquidity]
  );
  return findAgentByPhone(db, phone);
}

export async function publishAgentProfile(db, relayPublisher, agent) {
  const unsignedEvent = buildMip02AgentEvent(agent);
  const signedEvent = signEvent(unsignedEvent, agent.privkey);
  const relayResults = await relayPublisher.publish(signedEvent);
  await recordPublishedEvent(db, signedEvent, relayResults);
  return { event: signedEvent, relayResults };
}

export async function registerAgent(db, relayPublisher, input) {
  const existing = await findAgentByPhone(db, input.phone);
  if (existing) throw new Error('This phone number is already registered.');

  const agent = await createAgent(db, {
    phone: input.phone,
    name: validateName(input.name),
    currency: input.currency,
    payment_method: input.payment_method,
    liquidity: validateLiquidity(input.liquidity)
  });
  const published = await publishAgentProfile(db, relayPublisher, agent);
  return { agent, ...published };
}

export async function updateLiquidity(db, relayPublisher, agent, liquidity) {
  const amount = validateLiquidity(liquidity);
  await db.run('UPDATE agents SET liquidity = ? WHERE id = ?', [amount, agent.id]);
  const updatedAgent = await findAgentByPhone(db, agent.phone);
  const published = await publishAgentProfile(db, relayPublisher, updatedAgent);
  return { agent: updatedAgent, ...published };
}
