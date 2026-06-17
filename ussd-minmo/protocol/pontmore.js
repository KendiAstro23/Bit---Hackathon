import { nip19 } from 'nostr-tools';
import { verifySignedEvent } from '../nostr.js';

export const PONTMORE_PROTOCOL = 'pontmore';
export const PONTMORE_AGENT_IDENTIFIER = 'agent';
export const PONTMORE_ESCROW_IDENTIFIER = 'escrow';
export const PONTMORE_CLIENT = 'pontmore-minmo-ussd';
export const PONTMORE_VERSION = '0.1.0';

export const PONTMORE_KINDS = {
  agentDefinition: Number(process.env.PONTMORE_AGENT_KIND || 30360),
  escrowDescriptor: Number(process.env.PONTMORE_ESCROW_KIND || 30361),
  swapRequest: Number(process.env.PONTMORE_SWAP_REQUEST_KIND || 7300),
  swapTransition: Number(process.env.PONTMORE_SWAP_TRANSITION_KIND || 7301),
  swapEvidence: Number(process.env.PONTMORE_SWAP_EVIDENCE_KIND || 7302),
  swapDispute: Number(process.env.PONTMORE_SWAP_DISPUTE_KIND || 7303),
  swapNote: Number(process.env.PONTMORE_SWAP_NOTE_KIND || 7304),
  swapSnapshot: Number(process.env.PONTMORE_SWAP_SNAPSHOT_KIND || 30362)
};

export const DEFAULT_RELAYS = [];

export const DISPUTE_POLICY = {
  pip: 'PIP-03',
  dispute_classes: ['payment_dispute', 'timeout_dispute', 'operator_dispute'],
  timeout_classes: ['agent_response_timeout', 'fiat_settlement_timeout'],
  evidence_boundary: 'public_protocol_evidence_only',
  resolution_modes: ['operator_review']
};

const REQUIRED_PIPS = new Set(['PIP-00', 'PIP-01', 'PIP-02', 'PIP-00-draft', 'PIP-01-draft', 'PIP-02-draft']);
const PRIVATE_FIELD_NAMES = new Set([
  'phone',
  'phone_number',
  'privkey',
  'private_key',
  'session',
  'session_id',
  'payment_reference',
  'counterparty'
]);

function createdAt(overrides = {}) {
  return overrides.created_at || Math.floor(Date.now() / 1000);
}

function updatedAt(overrides = {}) {
  return overrides.updated_at || new Date(createdAt(overrides) * 1000).toISOString();
}

function tagValue(tags, name) {
  return tags.find((tag) => tag[0] === name)?.[1];
}

function hasPrivateField(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => hasPrivateField(item));
  return Object.entries(value).some(([key, child]) => PRIVATE_FIELD_NAMES.has(key) || hasPrivateField(child));
}

function parseContent(event) {
  try {
    return JSON.parse(event.content || '{}');
  } catch {
    throw new Error('Pontmore event content must be valid JSON.');
  }
}

function parseRelayList(value = process.env.NOSTR_RELAYS || '') {
  const relays = value
    .split(',')
    .map((relay) => relay.trim())
    .filter(Boolean);
  return relays.length > 0 ? relays : DEFAULT_RELAYS;
}

function normalizePaymentChannel(paymentMethod = '') {
  return String(paymentMethod).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function regionForCurrency(currency) {
  return {
    KES: 'KE',
    NGN: 'NG',
    UGX: 'UG',
    TZS: 'TZ',
    USD: 'US'
  }[currency] || currency;
}

function contentPip(content) {
  return content.pip || content.version;
}

function contentType(content, event) {
  if (content.type) return content.type;
  if (event.kind === PONTMORE_KINDS.agentDefinition) return 'agent_definition';
  if (event.kind === PONTMORE_KINDS.escrowDescriptor) return 'escrow_descriptor';
  if (event.kind === PONTMORE_KINDS.swapTransition) return 'swap_transition';
  if (event.kind === PONTMORE_KINDS.swapDispute) return 'swap_dispute';
  if (event.kind === PONTMORE_KINDS.swapSnapshot) return 'swap_snapshot';
  return undefined;
}

export function agentDescriptorId(agent) {
  return `${PONTMORE_KINDS.agentDefinition}:${agent.pubkey}:${PONTMORE_AGENT_IDENTIFIER}`;
}

export function escrowDescriptorId(agent) {
  return `${PONTMORE_KINDS.escrowDescriptor}:${agent.pubkey}:${PONTMORE_ESCROW_IDENTIFIER}`;
}

export function npubForAgent(agent) {
  return nip19.npubEncode(agent.pubkey);
}

export function buildPontmoreEscrowDescriptorEvent(agent, overrides = {}) {
  const descriptorId = escrowDescriptorId(agent);
  const networks = overrides.networks || ['bitcoin', 'lightning'];
  return {
    kind: Number(overrides.kind || PONTMORE_KINDS.escrowDescriptor),
    created_at: createdAt(overrides),
    tags: [
      ['d', PONTMORE_ESCROW_IDENTIFIER],
      ['t', 'escrow'],
      ['client', PONTMORE_CLIENT],
      ['a', agentDescriptorId(agent)],
      ...networks.map((network) => ['network', network])
    ],
    content: JSON.stringify({
      version: 'PIP-01-draft',
      name: `${agent.name || 'Minmo'} Escrow`,
      descriptor: descriptorId,
      agent: agentDescriptorId(agent),
      controller_pubkey: agent.pubkey,
      escrow_type: overrides.escrow_type || 'custodial_escrow',
      networks,
      funding_rules: {
        required_confirmation: 'operator_accepts_claim'
      },
      release_rules: {
        release_trigger: 'counterparty_fiat_payment_confirmed',
        refund_trigger: 'timeout_or_dispute_refund_decision'
      },
      dispute_rules: {
        policy: 'operator_resolved',
        classes: DISPUTE_POLICY.dispute_classes,
        timeout_classes: DISPUTE_POLICY.timeout_classes
      },
      reference_format: 'operator_escrow_reference',
      custody_authority: 'escrow_operator',
      release_authority: 'escrow_operator',
      refund_authority: 'escrow_operator',
      implementations: networks.map((network) => ({ network })),
      updated_at: updatedAt(overrides)
    })
  };
}

export function buildPontmoreAgentDefinitionEvent(agent, overrides = {}) {
  const liquidity = Number(agent.liquidity);
  const escrowId = escrowDescriptorId(agent);
  const relays = overrides.relays || parseRelayList();
  return {
    kind: Number(overrides.kind || PONTMORE_KINDS.agentDefinition),
    created_at: createdAt(overrides),
    tags: [
      ['d', PONTMORE_AGENT_IDENTIFIER],
      ['t', 'agent'],
      ['t', 'ussd'],
      ...relays.map((relay) => ['relay', relay]),
      ['a', escrowId],
      ['f', agent.currency],
      ['client', PONTMORE_CLIENT]
    ],
    content: JSON.stringify({
      version: 'PIP-00-draft',
      name: agent.name,
      about: agent.about || `Minmo USSD liquidity Agent offering Bitcoin swaps in ${regionForCurrency(agent.currency)}`,
      capabilities: {
        swap_types: ['fiat-to-btc', 'btc-to-fiat'],
        fiat_currencies: [agent.currency],
        payment_channels: [normalizePaymentChannel(agent.payment_method)],
        settlement_networks: ['lightning', 'bitcoin'],
        regions: [regionForCurrency(agent.currency)],
        access_channels: ['ussd'],
        limits: {
          min: String(overrides.min_limit || process.env.PONTMORE_MIN_LIMIT || 500),
          max: String(overrides.max_limit || liquidity)
        }
      },
      pricing_policy: overrides.pricing_policy || process.env.PONTMORE_PRICING_POLICY || 'Operator quoted spread shown before settlement',
      escrow: {
        descriptor: escrowId,
        notes: ''
      },
      updated_at: updatedAt(overrides)
    })
  };
}

export function buildPontmoreSwapTransitionEvent({ agent, swap, action, nextState, reason, overrides = {} }) {
  const eventCreatedAt = createdAt(overrides);
  return {
    kind: Number(overrides.kind || PONTMORE_KINDS.swapTransition),
    created_at: eventCreatedAt,
    tags: [
      ['protocol', PONTMORE_PROTOCOL],
      ['pip', '02'],
      ['type', 'swap_transition'],
      ['swap', swap.swap_id],
      ['agent', agent.pubkey],
      ['escrow', escrowDescriptorId(agent)],
      ['a', agentDescriptorId(agent)],
      ['previous_state', swap.status],
      ['state', nextState],
      ['action', action]
    ],
    content: JSON.stringify({
      protocol: PONTMORE_PROTOCOL,
      pip: 'PIP-02',
      type: 'swap_transition',
      version: PONTMORE_VERSION,
      swap_id: swap.swap_id,
      state: nextState,
      prev_state: swap.status,
      actor_role: 'agent',
      reason: reason || action,
      created_at: eventCreatedAt,
      actor_pubkey: agent.pubkey,
      escrow_descriptor: escrowDescriptorId(agent),
      previous_state: swap.status,
      next_state: nextState,
      action,
      evidence_refs: []
    })
  };
}

export function buildPontmoreDisputeEvent({ agent, swap, reason = 'operator_dispute', overrides = {} }) {
  const eventCreatedAt = createdAt(overrides);
  const disputeClass = reason === 'operator_dispute' ? 'payment not received' : reason;
  return {
    kind: Number(overrides.kind || PONTMORE_KINDS.swapDispute),
    created_at: eventCreatedAt,
    tags: [
      ['protocol', PONTMORE_PROTOCOL],
      ['pip', '02'],
      ['type', 'swap_dispute'],
      ['swap', swap.swap_id],
      ['agent', agent.pubkey],
      ['escrow', escrowDescriptorId(agent)],
      ['a', agentDescriptorId(agent)],
      ['previous_state', swap.status],
      ['state', 'disputed'],
      ['dispute_class', disputeClass]
    ],
    content: JSON.stringify({
      protocol: PONTMORE_PROTOCOL,
      pip: 'PIP-02',
      type: 'swap_dispute',
      version: PONTMORE_VERSION,
      swap_id: swap.swap_id,
      state: 'disputed',
      prev_state: swap.status,
      actor_role: 'agent',
      reason: disputeClass,
      created_at: eventCreatedAt,
      actor_pubkey: agent.pubkey,
      escrow_descriptor: escrowDescriptorId(agent),
      previous_state: swap.status,
      next_state: 'disputed',
      dispute_class: disputeClass,
      evidence_refs: [],
      dispute_policy: DISPUTE_POLICY
    })
  };
}

export function assertPontmoreEventEnvelope(event) {
  if (!Number.isInteger(event.kind) || event.kind <= 0) throw new Error('Pontmore event kind must be a positive integer.');
  if (!Number.isInteger(event.created_at) || event.created_at <= 0) throw new Error('Pontmore event created_at must be a Unix timestamp.');
  if (!Array.isArray(event.tags)) throw new Error('Pontmore event tags must be an array.');

  const content = parseContent(event);
  const pip = contentPip(content);
  const type = contentType(content, event);
  if (!REQUIRED_PIPS.has(pip)) throw new Error('Pontmore event references an unsupported PIP.');
  if (tagValue(event.tags, 'pip') && tagValue(event.tags, 'pip') !== pip.replace('PIP-', '').replace('-draft', '')) {
    throw new Error('Pontmore event PIP tag must match content.');
  }
  if (tagValue(event.tags, 'type') && tagValue(event.tags, 'type') !== type) throw new Error('Pontmore event type tag must match content.');
  if (event.kind === PONTMORE_KINDS.agentDefinition) {
    if (!tagValue(event.tags, 'd')) throw new Error('Pontmore event must include a discovery d tag.');
    if (tagValue(event.tags, 'd') !== PONTMORE_AGENT_IDENTIFIER) throw new Error('Pontmore Agent event must use d=agent.');
    if (tagValue(event.tags, 't') !== 'agent') throw new Error('Pontmore Agent event must include t=agent.');
    const escrowCoordinate = tagValue(event.tags, 'a');
    if (!escrowCoordinate?.startsWith(`${PONTMORE_KINDS.escrowDescriptor}:`)) {
      throw new Error('Pontmore Agent event must reference its escrow coordinate.');
    }
    if (event.pubkey && !escrowCoordinate.startsWith(`${PONTMORE_KINDS.escrowDescriptor}:${event.pubkey}:`)) {
      throw new Error('Pontmore Agent event escrow coordinate must match the signer.');
    }
    if (!Array.isArray(content.capabilities?.access_channels) || !content.capabilities.access_channels.includes('ussd')) {
      throw new Error('Pontmore Minmo Agent event must declare USSD access.');
    }
  }
  if (event.kind === PONTMORE_KINDS.escrowDescriptor) {
    if (!tagValue(event.tags, 'd')) throw new Error('Pontmore event must include a discovery d tag.');
    if (tagValue(event.tags, 'd') !== PONTMORE_ESCROW_IDENTIFIER) throw new Error('Pontmore escrow event must use d=escrow.');
    for (const field of ['escrow_type', 'networks', 'funding_rules', 'release_rules', 'dispute_rules', 'reference_format', 'updated_at']) {
      if (content[field] === undefined) throw new Error(`Pontmore escrow descriptor missing ${field}.`);
    }
    if (!Array.isArray(content.networks) || content.networks.length === 0) throw new Error('Pontmore escrow networks must be non-empty.');
  }
  if (event.kind === PONTMORE_KINDS.swapTransition) {
    for (const field of ['swap_id', 'state', 'prev_state', 'actor_role', 'reason', 'created_at']) {
      if (content[field] === undefined) throw new Error(`Pontmore swap transition missing ${field}.`);
    }
  }
  if (event.kind === PONTMORE_KINDS.swapDispute) {
    for (const field of ['swap_id', 'state', 'prev_state', 'actor_role', 'reason', 'created_at', 'dispute_class']) {
      if (content[field] === undefined) throw new Error(`Pontmore swap dispute missing ${field}.`);
    }
  }
  if (hasPrivateField(content)) throw new Error('Pontmore event content contains private operator data.');
  if (event.tags.some((tag) => tag.some((part) => PRIVATE_FIELD_NAMES.has(part)))) {
    throw new Error('Pontmore event tags contain private operator data.');
  }

  return content;
}

export function verifyPontmoreSignedEvent(event) {
  if (!verifySignedEvent(event)) throw new Error('Pontmore event signature verification failed.');
  const content = assertPontmoreEventEnvelope(event);
  const expectedPubkey = content.agent?.pubkey || content.controller_pubkey || content.escrow?.controller_pubkey || content.actor_pubkey || event.pubkey;
  if (!expectedPubkey) throw new Error('Pontmore event content must identify the signing Agent pubkey.');
  if (event.pubkey !== expectedPubkey) throw new Error('Pontmore event signer does not match the Agent pubkey.');
  if (tagValue(event.tags, 'agent') && tagValue(event.tags, 'agent') !== expectedPubkey) {
    throw new Error('Pontmore event agent tag must match the signer.');
  }
  return true;
}

export function buildPontmoreAgentRecord(event) {
  const content = parseContent(event);
  return {
    coordinate: `${event.kind}:${event.pubkey}:${tagValue(event.tags, 'd')}`,
    npub: nip19.npubEncode(event.pubkey),
    identifier: tagValue(event.tags, 'd'),
    content,
    event
  };
}
