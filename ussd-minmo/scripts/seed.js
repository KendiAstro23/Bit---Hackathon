import 'dotenv/config';
import { getDb, initDb } from '../db.js';
import { createAgent } from '../services/agents.js';

const db = await getDb();
await initDb(db);

let agent = await db.get('SELECT * FROM agents WHERE phone = ?', ['+254700000001']);
if (!agent) {
  agent = await createAgent(db, {
    phone: '+254700000001',
    name: 'Demo Agent',
    currency: 'KES',
    payment_method: 'M-PESA',
    liquidity: 50000
  });
}

const swaps = [
  ['SWAP-1001', agent.pubkey, agent.phone, 'KES', 'BTC', 2500, 1800, 'pending', 'MPESA-1001', 'buyer_alpha'],
  ['SWAP-1002', agent.pubkey, agent.phone, 'KES', 'BTC', 4100, 2900, 'assigned', 'MPESA-1002', 'buyer_beta']
];

for (const swap of swaps) {
  await db.run(
    `INSERT OR IGNORE INTO swaps
      (swap_id, agent_pubkey, agent_phone, from_currency, to_currency, fiat_amount, btc_amount_sats, status, payment_reference, counterparty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    swap
  );
}

console.log('Seed complete: demo agent +254700000001 with two pending swaps.');
await db.close();
