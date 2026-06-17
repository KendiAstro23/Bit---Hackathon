import { recordPublishedEvent } from '../db.js';
import { signEvent } from '../nostr.js';
import {
  assertPontmoreEventEnvelope,
  buildPontmoreDisputeEvent,
  buildPontmoreSwapTransitionEvent,
  verifyPontmoreSignedEvent
} from '../protocol/pontmore.js';

const OPEN_STATUSES = ['pending', 'assigned'];
const COMPLETED_STATUSES = ['payment_sent', 'completed'];
const DISPUTED_STATUSES = ['disputed'];

export async function listPendingSwaps(db, agent) {
  return db.all(
    `SELECT * FROM swaps
     WHERE (agent_phone = ? OR agent_pubkey = ?)
       AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
     ORDER BY created_at ASC
     LIMIT 5`,
    [agent.phone, agent.pubkey, ...OPEN_STATUSES]
  );
}

export async function listSwapsByStatus(db, agent, statuses, { limit = 5, offset = 0 } = {}) {
  return db.all(
    `SELECT * FROM swaps
     WHERE (agent_phone = ? OR agent_pubkey = ?)
       AND status IN (${statuses.map(() => '?').join(',')})
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ? OFFSET ?`,
    [agent.phone, agent.pubkey, ...statuses, limit, offset]
  );
}

export async function countSwapsByStatus(db, agent, statuses) {
  const row = await db.get(
    `SELECT COUNT(*) AS total
     FROM swaps
     WHERE (agent_phone = ? OR agent_pubkey = ?)
       AND status IN (${statuses.map(() => '?').join(',')})`,
    [agent.phone, agent.pubkey, ...statuses]
  );
  return Number(row?.total || 0);
}

export async function listOpenSwaps(db, agent, paging) {
  return listSwapsByStatus(db, agent, OPEN_STATUSES, paging);
}

export async function countOpenSwaps(db, agent) {
  return countSwapsByStatus(db, agent, OPEN_STATUSES);
}

export async function listCompletedSwaps(db, agent, paging) {
  return listSwapsByStatus(db, agent, COMPLETED_STATUSES, paging);
}

export async function countCompletedSwaps(db, agent) {
  return countSwapsByStatus(db, agent, COMPLETED_STATUSES);
}

export async function listDisputedSwaps(db, agent, paging) {
  return listSwapsByStatus(db, agent, DISPUTED_STATUSES, paging);
}

export async function countDisputedSwaps(db, agent) {
  return countSwapsByStatus(db, agent, DISPUTED_STATUSES);
}

export async function getSwapById(db, swapId) {
  return db.get('SELECT * FROM swaps WHERE swap_id = ?', [swapId]);
}

export async function getSwapStats(db, agent) {
  const row = await db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'payment_sent' THEN 1 ELSE 0 END) AS payment_sent,
       SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) AS disputed,
       SUM(CASE WHEN status IN ('pending', 'assigned') THEN 1 ELSE 0 END) AS pending
     FROM swaps
     WHERE agent_phone = ? OR agent_pubkey = ?`,
    [agent.phone, agent.pubkey]
  );
  return {
    total: Number(row?.total || 0),
    payment_sent: Number(row?.payment_sent || 0),
    disputed: Number(row?.disputed || 0),
    pending: Number(row?.pending || 0)
  };
}

export async function createSwapRequest(db, agent, { recipient }) {
  const timestamp = Date.now();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  const swapId = `SWAP-${timestamp}-${suffix}`;
  const reference = `MINMO-${String(timestamp).slice(-6)}-${suffix}`;
  await db.run(
    `INSERT INTO swaps
      (swap_id, agent_pubkey, agent_phone, from_currency, to_currency, fiat_amount, btc_amount_sats, status, payment_reference, counterparty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [swapId, agent.pubkey, agent.phone, agent.currency, 'BTC', 0, 0, 'pending', reference, recipient]
  );
  return getSwapById(db, swapId);
}

async function publishTransition(db, relayPublisher, { agent, swap, action, nextState, reason }) {
  const unsignedEvent = buildPontmoreSwapTransitionEvent({ agent, swap, action, nextState, reason });
  assertPontmoreEventEnvelope(unsignedEvent);
  const signedEvent = signEvent(unsignedEvent, agent.privkey);
  verifyPontmoreSignedEvent(signedEvent);
  const relayResults = await relayPublisher.publish(signedEvent);
  await recordPublishedEvent(db, signedEvent, relayResults);
  return { event: signedEvent, relayResults };
}

async function publishDispute(db, relayPublisher, { agent, swap, reason }) {
  const unsignedEvent = buildPontmoreDisputeEvent({ agent, swap, reason });
  assertPontmoreEventEnvelope(unsignedEvent);
  const signedEvent = signEvent(unsignedEvent, agent.privkey);
  verifyPontmoreSignedEvent(signedEvent);
  const relayResults = await relayPublisher.publish(signedEvent);
  await recordPublishedEvent(db, signedEvent, relayResults);
  return { event: signedEvent, relayResults };
}

export async function markPaymentSent(db, relayPublisher, agent, swapId) {
  const swap = await getSwapById(db, swapId);
  if (!swap) throw new Error('Swap not found.');
  if (![...OPEN_STATUSES, 'fiat_pending'].includes(swap.status)) {
    throw new Error('This swap cannot be marked as paid from its current state.');
  }

  const published = await publishTransition(db, relayPublisher, {
    agent,
    swap,
    action: 'mark_payment_sent',
    nextState: 'payment_sent'
  });
  await db.run('UPDATE swaps SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE swap_id = ?', ['payment_sent', swapId]);
  return published;
}

export async function raiseDispute(db, relayPublisher, agent, swapId, reason = 'operator_dispute') {
  const swap = await getSwapById(db, swapId);
  if (!swap) throw new Error('Swap not found.');
  if (swap.status === 'completed') throw new Error('Completed swaps cannot be disputed.');

  const published = await publishDispute(db, relayPublisher, {
    agent,
    swap,
    reason
  });
  await db.run('UPDATE swaps SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE swap_id = ?', ['disputed', swapId]);
  return published;
}
