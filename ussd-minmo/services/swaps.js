import { recordPublishedEvent } from '../db.js';
import { buildMip04TransitionEvent } from '../mip04.js';
import { signEvent } from '../nostr.js';

const OPEN_STATUSES = ['pending', 'assigned'];

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

async function publishTransition(db, relayPublisher, { agent, swap, action, nextState, reason }) {
  const unsignedEvent = buildMip04TransitionEvent({ agent, swap, action, nextState, reason });
  const signedEvent = signEvent(unsignedEvent, agent.privkey);
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

export async function raiseDispute(db, relayPublisher, agent, swapId, reason = 'agent_raised_dispute') {
  const swap = await getSwapById(db, swapId);
  if (!swap) throw new Error('Swap not found.');
  if (swap.status === 'completed') throw new Error('Completed swaps cannot be disputed.');

  const published = await publishTransition(db, relayPublisher, {
    agent,
    swap,
    action: 'raise_dispute',
    nextState: 'disputed',
    reason
  });
  await db.run('UPDATE swaps SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE swap_id = ?', ['disputed', swapId]);
  return published;
}
