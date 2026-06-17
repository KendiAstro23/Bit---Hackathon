import { recordPublishedEvent } from '../db.js';
import { randomInt, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { createKeypair, signEvent } from '../nostr.js';
import {
  assertPontmoreEventEnvelope,
  buildPontmoreAgentDefinitionEvent,
  buildPontmoreAgentRecord,
  buildPontmoreEscrowDescriptorEvent,
  verifyPontmoreSignedEvent
} from '../protocol/pontmore.js';

export const CURRENCIES = ['KES', 'NGN', 'UGX', 'TZS', 'USD'];
export const PAYMENT_METHODS = ['M-PESA', 'Bank Transfer', 'Airtel Money', 'Mobile Money'];
const DEFAULT_CURRENCY = 'KES';
const DEFAULT_PAYMENT_METHOD = 'M-PESA';
const OTP_TTL_MS = Number(process.env.MINMO_OTP_TTL_MS || 5 * 60 * 1000);

export function normalizePhone(phone) {
  return String(phone || '').replace(/\s+/g, '');
}

export function validateMpesaNumber(phone) {
  const raw = normalizePhone(phone);
  const digits = raw.replace(/^\+/, '');
  if (/^07\d{8}$/.test(raw)) return `+254${raw.slice(1)}`;
  if (/^2547\d{8}$/.test(digits)) return `+${digits}`;
  if (/^\+2547\d{8}$/.test(raw)) return raw;
  throw new Error('Enter a valid M-Pesa number.');
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

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 4 || value.length > 32) throw new Error('Password must be 4 to 32 characters.');
  if (/\s/.test(value)) throw new Error('Password cannot include spaces.');
  return value;
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

export async function findAgentByMpesa(db, phone) {
  return findAgentByPhone(db, validateMpesaNumber(phone));
}

export async function createAgent(db, { phone, name, currency, payment_method, liquidity }) {
  const keypair = createKeypair();
  await db.run(
    `INSERT INTO agents (phone, name, pubkey, privkey, currency, payment_method, liquidity, signup_status, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [normalizePhone(phone), name, keypair.pubkey, keypair.privkey, currency, payment_method, liquidity, 'active', 'active']
  );
  return findAgentByPhone(db, phone);
}

function hashOtp(otp) {
  return createHash('sha256').update(String(otp)).digest('hex');
}

function generateOtp() {
  return process.env.MINMO_FIXED_OTP || String(randomInt(100000, 1000000));
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || !passwordHash.includes(':')) return false;
  const [salt, storedHash] = passwordHash.split(':');
  const candidate = scryptSync(password, salt, 32);
  const stored = Buffer.from(storedHash, 'hex');
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

export async function createPendingAgent(db, { phone, name }) {
  const mpesaPhone = validateMpesaNumber(phone);
  const existing = await findAgentByPhone(db, mpesaPhone);
  if (existing?.signup_status === 'active') throw new Error('This M-Pesa number already has an account.');
  if (existing) {
    await db.run('UPDATE agents SET name = ?, signup_status = ? WHERE id = ?', [validateName(name), 'pending_otp', existing.id]);
    return findAgentByPhone(db, mpesaPhone);
  }

  const keypair = createKeypair();
  await db.run(
    `INSERT INTO agents
      (phone, name, pubkey, privkey, currency, payment_method, liquidity, signup_status, account_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [mpesaPhone, validateName(name), keypair.pubkey, keypair.privkey, DEFAULT_CURRENCY, DEFAULT_PAYMENT_METHOD, 0, 'pending_otp', 'pending']
  );
  return findAgentByPhone(db, mpesaPhone);
}

export async function requestSignupOtp(db, agent, otpSender = {}) {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await db.run(
    'UPDATE agents SET otp_hash = ?, otp_expires_at = ?, signup_status = ? WHERE id = ?',
    [hashOtp(otp), expiresAt, 'pending_otp', agent.id]
  );
  await otpSender.sendOtp?.({ phone: agent.phone, otp });
  return { otp, expiresAt };
}

export async function verifySignupOtp(db, agent, otp) {
  const value = String(otp || '').trim();
  if (!/^\d{6}$/.test(value)) throw new Error('Enter the 6 digit OTP.');
  if (!agent.otp_hash || !agent.otp_expires_at) throw new Error('Request a new OTP first.');
  if (new Date(agent.otp_expires_at).getTime() < Date.now()) throw new Error('OTP expired. Continue signup to request a new one.');
  if (hashOtp(value) !== agent.otp_hash) throw new Error('Invalid OTP.');
  await db.run(
    'UPDATE agents SET otp_verified_at = CURRENT_TIMESTAMP, signup_status = ? WHERE id = ?',
    ['pending_password', agent.id]
  );
}

export async function setAgentPassword(db, agent, password) {
  const value = validatePassword(password);
  await db.run(
    'UPDATE agents SET password_hash = ?, signup_status = ?, account_status = ?, otp_hash = NULL, otp_expires_at = NULL WHERE id = ?',
    [hashPassword(value), 'active', 'active', agent.id]
  );
  return findAgentByPhone(db, agent.phone);
}

export async function authenticateAgent(db, phone, password) {
  const agent = await findAgentByMpesa(db, phone);
  if (!agent || agent.signup_status !== 'active' || agent.account_status !== 'active') {
    throw new Error('Account not found or signup incomplete.');
  }
  if (!verifyPassword(validatePassword(password), agent.password_hash)) throw new Error('Invalid login details.');
  return agent;
}

export async function changeAgentPassword(db, agent, currentPassword, nextPassword) {
  if (!verifyPassword(validatePassword(currentPassword), agent.password_hash)) throw new Error('Current password is incorrect.');
  await db.run('UPDATE agents SET password_hash = ? WHERE id = ?', [hashPassword(validatePassword(nextPassword)), agent.id]);
  return findAgentByPhone(db, agent.phone);
}

async function signVerifyPublish(db, relayPublisher, agent, unsignedEvent) {
  assertPontmoreEventEnvelope(unsignedEvent);
  const signedEvent = signEvent(unsignedEvent, agent.privkey);
  verifyPontmoreSignedEvent(signedEvent);
  const relayResults = await relayPublisher.publish(signedEvent);
  await recordPublishedEvent(db, signedEvent, relayResults);
  return { event: signedEvent, relayResults };
}

export async function publishAgentDefinition(db, relayPublisher, agent, { includeEscrow = false } = {}) {
  const results = [];
  if (includeEscrow) {
    results.push(await signVerifyPublish(db, relayPublisher, agent, buildPontmoreEscrowDescriptorEvent(agent)));
  }

  const agentDefinition = await signVerifyPublish(
    db,
    relayPublisher,
    agent,
    buildPontmoreAgentDefinitionEvent(agent)
  );
  results.push(agentDefinition);
  return {
    event: agentDefinition.event,
    relayResults: agentDefinition.relayResults,
    events: results.map((result) => result.event),
    agentRecord: buildPontmoreAgentRecord(agentDefinition.event)
  };
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
  const published = await publishAgentDefinition(db, relayPublisher, agent, { includeEscrow: true });
  return { agent, ...published };
}

export async function updateLiquidity(db, relayPublisher, agent, liquidity) {
  const amount = validateLiquidity(liquidity);
  await db.run('UPDATE agents SET liquidity = ? WHERE id = ?', [amount, agent.id]);
  const updatedAgent = await findAgentByPhone(db, agent.phone);
  const published = await publishAgentDefinition(db, relayPublisher, updatedAgent);
  return { agent: updatedAgent, ...published };
}
