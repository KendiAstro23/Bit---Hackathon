const DEFAULT_KIND = Number(process.env.MIP04_KIND || 30078);

// MIP-04 swap transition event builder. Private operator data stays local; the
// public event contains only lifecycle facts needed by relays and indexers.
export function buildMip04TransitionEvent({ agent, swap, action, nextState, reason, overrides = {} }) {
  const createdAt = overrides.created_at || Math.floor(Date.now() / 1000);
  return {
    kind: Number(overrides.kind || DEFAULT_KIND),
    created_at: createdAt,
    tags: [
      ['d', `minmo:swap:${swap.swap_id}:transition:${createdAt}`],
      ['protocol', 'minmo'],
      ['mip', '04'],
      ['type', 'swap_state_transition'],
      ['swap', swap.swap_id],
      ['agent', agent.pubkey],
      ['previous_state', swap.status],
      ['state', nextState],
      ['action', action]
    ],
    content: JSON.stringify({
      protocol: 'minmo',
      mip: 'MIP-04',
      type: 'swap_state_transition',
      version: '0.1.0',
      swap_id: swap.swap_id,
      actor_pubkey: agent.pubkey,
      previous_state: swap.status,
      next_state: nextState,
      action,
      reason: reason || null,
      implementation_assumption:
        'MIP-04 transition kind and exact transition labels are configurable until canonical Minmo/Pontmore values are available.'
    })
  };
}
