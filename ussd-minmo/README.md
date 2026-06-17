# Minmo Agent USSD

Production-ready USSD starter for Bitcoin liquidity agents using Node.js, Express, SQLite, `nostr-tools`, WebSocket relay publishing, and the Africa's Talking USSD sandbox.

The app stores private operator state such as sessions, phone numbers, and local swap queues in SQLite. Public protocol actions are signed as Nostr events and published to configured relays. Because canonical Minmo MIP kind numbers were not included in the prompt, `MIP02_KIND` and `MIP04_KIND` are environment-configurable implementation assumptions.

## Structure

```text
ussd-minmo/
  index.js
  db.js
  sessions.js
  menus.js
  nostr.js
  mip02.js
  mip04.js
  relay.js
  services/
    agents.js
    swaps.js
  routes/
    ussd.js
  schema.sql
  scripts/
    seed.js
    demo.js
  tests/
```

## Local Setup

1. Install Node.js `18.17.0` or newer. Node `20.x` or `22.x` LTS is recommended.
2. Install dependencies:

```bash
npm install
```

3. Create local environment config:

```bash
cp .env.example .env
```

4. Seed demo data:

```bash
npm run seed
```

5. Start the server:

```bash
npm run dev
```

6. Check health:

```bash
curl http://localhost:3000/health
```

## Africa's Talking Sandbox Deployment

1. Open the Africa's Talking sandbox dashboard and create a USSD channel.
2. Set the callback URL to your public webhook, for example `https://your-domain.example/ussd`.
3. For local testing, expose the app with a tunnel such as ngrok and use `https://<subdomain>.ngrok-free.app/ussd`.
4. Configure `.env` with `AFRICASTALKING_USERNAME=sandbox`, your sandbox API key, `USSD_SERVICE_CODE`, and production relay URLs.
5. Deploy the Node app behind HTTPS. The webhook accepts `application/x-www-form-urlencoded` fields: `sessionId`, `serviceCode`, `phoneNumber`, and `text`.
6. Africa's Talking expects responses beginning with `CON` for continuing menus and `END` for terminal messages.

## End-to-End Demo

Start the server in one terminal:

```bash
npm run dev
```

In another terminal, run:

```bash
npm run demo
```

The demo posts the same cumulative `text` values Africa's Talking sends during registration:

```text
""
"1"
"1*Amina Doe"
"1*Amina Doe*1"
"1*Amina Doe*1*1"
"1*Amina Doe*1*1*25000"
"1*Amina Doe*1*1*25000*1"
```

For a returning seeded agent, use phone `+254700000001` in the Africa's Talking simulator to view swap requests.

## Example MIP-02 Event Payload

```json
{
  "kind": 31990,
  "tags": [
    ["d", "minmo:agent:<pubkey>"],
    ["protocol", "minmo"],
    ["mip", "02"],
    ["type", "agent_profile"],
    ["agent", "<pubkey>"],
    ["currency", "KES"],
    ["payment_method", "M-PESA"],
    ["liquidity", "50000"]
  ],
  "content": {
    "protocol": "minmo",
    "mip": "MIP-02",
    "type": "agent_profile",
    "version": "0.1.0",
    "agent": {
      "name": "Demo Agent",
      "pubkey": "<pubkey>",
      "currency": "KES",
      "payment_method": "M-PESA",
      "liquidity": 50000
    }
  }
}
```

## Example MIP-04 Event Payload

```json
{
  "kind": 30078,
  "tags": [
    ["d", "minmo:swap:SWAP-1001:transition:<created_at>"],
    ["protocol", "minmo"],
    ["mip", "04"],
    ["type", "swap_state_transition"],
    ["swap", "SWAP-1001"],
    ["agent", "<agent_pubkey>"],
    ["previous_state", "pending"],
    ["state", "payment_sent"],
    ["action", "mark_payment_sent"]
  ],
  "content": {
    "protocol": "minmo",
    "mip": "MIP-04",
    "type": "swap_state_transition",
    "version": "0.1.0",
    "swap_id": "SWAP-1001",
    "actor_pubkey": "<agent_pubkey>",
    "previous_state": "pending",
    "next_state": "payment_sent",
    "action": "mark_payment_sent",
    "reason": null
  }
}
```

## Tests

```bash
npm test
```

The tests cover session routing, registration, float updates, and signed MIP-02/MIP-04 Nostr event creation.
