# Pontmore Minmo USSD

Production-ready USSD starter for Minmo Bitcoin liquidity Agents using Node.js, Express, SQLite, `nostr-tools`, WebSocket relay publishing, and the Africa's Talking USSD sandbox.

The app stores private operator state such as sessions, phone numbers, and local swap queues in SQLite. Public protocol actions are Pontmore Nostr events, signed by the Agent key, locally verified, and published to configured relays.

Pontmore integration decision:

- `PIP-00`: public Agent definition and capability discovery record, emitted as a POC-compatible replaceable event kind `30360` with `d=agent`.
- `PIP-01`: public escrow descriptor referenced by the Agent definition, emitted as kind `30361` with `d=escrow`.
- `PIP-02`: swap lifecycle transition and dispute events.
- `PIP-03`: dispute policy attached to escrow and dispute events.
- USSD is not modeled as a separate Pontmore protocol object in this implementation. It is advertised as an Agent access surface through the Agent content `capabilities.access_channels: ["ussd"]` and the discoverability tag `["t", "ussd"]`, while phone numbers and USSD sessions remain private operator state.

The app follows the current Pontmore kind mapping: `PONTMORE_AGENT_KIND=30360`, `PONTMORE_ESCROW_KIND=30361`, `PONTMORE_SWAP_TRANSITION_KIND=7301`, `PONTMORE_SWAP_DISPUTE_KIND=7303`, and `PONTMORE_SWAP_SNAPSHOT_KIND=30362`.

## Structure

```text
ussd-minmo/
  index.js
  db.js
  docs/
    pontmore-ussd-integration.md
  sessions.js
  menus.js
  nostr.js
  protocol/
    pontmore.js
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

For Pontmore dashboard visibility, set `NOSTR_RELAYS` to the relay URLs indexed by the dashboard before registering or updating an Agent. Without `NOSTR_RELAYS`, events are still signed, verified, and stored locally, but they are not published to public relays.

## Verification Checks

Before any relay publish, the app verifies that each Pontmore event:

- has a valid Nostr signature and signer pubkey.
- uses a supported required PIP draft marker (`PIP-00-draft`, `PIP-01-draft`, `PIP-02`, or compatible explicit fields).
- includes replaceable-event discovery `d` tags for Agent and escrow records.
- uses `d=agent`, `t=agent`, an escrow `a` coordinate, and `capabilities.access_channels: ["ussd"]` for Minmo Agent records.
- verifies that signed Agent escrow coordinates match the signer pubkey.
- verifies PIP-01 escrow minimum fields and PIP-02 transition/dispute required fields.
- excludes private operator data such as phone numbers, sessions, payment references, counterparties, and private keys.

## Example PIP-00 Agent Record

```json
{
  "coordinate": "30360:<pubkey>:agent",
  "npub": "npub1...",
  "identifier": "agent",
  "content": {
    "version": "PIP-00-draft",
    "name": "Demo Agent",
    "about": "Minmo USSD liquidity Agent offering Bitcoin swaps in KE",
    "capabilities": {
      "swap_types": ["fiat-to-btc", "btc-to-fiat"],
      "fiat_currencies": ["KES"],
      "payment_channels": ["mpesa"],
      "settlement_networks": ["lightning", "bitcoin"],
      "regions": ["KE"],
      "access_channels": ["ussd"],
      "limits": { "min": "500", "max": "50000" }
    },
    "pricing_policy": "Operator quoted spread shown before settlement",
    "escrow": {
      "descriptor": "30361:<pubkey>:escrow",
      "notes": ""
    },
    "updated_at": "2026-06-17T17:22:56.083Z"
  },
  "event": {
    "kind": 30360,
    "pubkey": "<pubkey>",
    "tags": [
      ["d", "agent"],
      ["t", "agent"],
      ["t", "ussd"],
      ["relay", "wss://relay.example"],
      ["a", "30361:<pubkey>:escrow"],
      ["f", "KES"],
      ["client", "pontmore-minmo-ussd"]
    ],
    "content": "<json string of content>",
    "created_at": 1781716976,
    "id": "<event-id>",
    "sig": "<signature>"
  }
}
```

## Example PIP-02 Swap Transition Event

```json
{
  "kind": 7301,
  "tags": [
    ["protocol", "pontmore"],
    ["pip", "02"],
    ["type", "swap_transition"],
    ["swap", "SWAP-1001"],
    ["agent", "<agent_pubkey>"],
    ["escrow", "30361:<agent_pubkey>:escrow"],
    ["a", "30360:<agent_pubkey>:agent"],
    ["previous_state", "pending"],
    ["state", "payment_sent"],
    ["action", "mark_payment_sent"]
  ],
  "content": {
    "protocol": "pontmore",
    "pip": "PIP-02",
    "type": "swap_transition",
    "version": "0.1.0",
    "swap_id": "SWAP-1001",
    "state": "payment_sent",
    "prev_state": "pending",
    "actor_role": "agent",
    "reason": "mark_payment_sent",
    "created_at": 1781716976,
    "actor_pubkey": "<agent_pubkey>",
    "escrow_descriptor": "30361:<agent_pubkey>:escrow",
    "previous_state": "pending",
    "next_state": "payment_sent",
    "action": "mark_payment_sent",
    "evidence_refs": []
  }
}
```

## Tests

```bash
npm test
```

The tests cover session routing, registration, float updates, signed Pontmore event creation, and protocol verification failures.
