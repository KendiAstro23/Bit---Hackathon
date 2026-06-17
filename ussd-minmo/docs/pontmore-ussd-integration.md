# Pontmore USSD Integration Note

This implementation does not define USSD as a new canonical Pontmore object. USSD is a transport and access surface for a Pontmore Agent.

## PIP-00 Agent Discovery

Minmo USSD Agents publish the POC-compatible Agent event:

- kind `30360`
- `["d", "agent"]`
- `["t", "agent"]`
- `["t", "ussd"]`
- `["a", "30361:<agent-pubkey>:escrow"]`
- `["f", "<fiat-currency>"]`

The event content uses `version: "PIP-00-draft"` and adds `capabilities.access_channels: ["ussd"]`. This makes USSD discoverable without publishing phone numbers, service codes, sessions, or operator-only routing data.

## PIP-01 Escrow Reference

Each Agent references an escrow coordinate in the same shape used by the Pontmore POC:

```text
30361:<agent-pubkey>:escrow
```

The local implementation publishes the escrow descriptor before the Agent definition during registration.

## PIP-02 Swap Lifecycle

USSD menu actions emit normal Pontmore swap lifecycle events. The USSD session is not canonical state.

- state changes use transition kind `7301`
- disputes use dispute kind `7303`
- snapshots, when needed, use replaceable kind `30362`

The public event records only the Agent, swap id, escrow coordinate, previous state, next state, action or dispute class, and public evidence references.

## PIP-03 Dispute Policy

Dispute events include the public dispute policy. Private operator judgments, phone numbers, payment references, and screenshots remain local unless a future Pontmore evidence convention explicitly allows them.

## Verification Rules

Before relay publication, the implementation verifies:

- Nostr event signatures.
- PIP draft markers.
- replaceable-event `d` tags.
- Agent `30360:<pubkey>:agent` and escrow `30361:<pubkey>:escrow` coordinates.
- USSD discoverability on Agent events.
- absence of private operator fields in public event content and tags.
