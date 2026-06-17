const DEFAULT_KIND = Number(process.env.MIP02_KIND || 31990);

// MIP-02 agent profile event builder. The kind is configurable because the
// prompt does not provide canonical Minmo/Pontmore Nostr kind assignments.
export function buildMip02AgentEvent(agent, overrides = {}) {
  const liquidity = Number(agent.liquidity);
  return {
    kind: Number(overrides.kind || DEFAULT_KIND),
    created_at: overrides.created_at || Math.floor(Date.now() / 1000),
    tags: [
      ['d', `minmo:agent:${agent.pubkey}`],
      ['protocol', 'minmo'],
      ['mip', '02'],
      ['type', 'agent_profile'],
      ['agent', agent.pubkey],
      ['phone_hash_hint', agent.phone.slice(-4)],
      ['currency', agent.currency],
      ['payment_method', agent.payment_method],
      ['liquidity', String(liquidity)]
    ],
    content: JSON.stringify({
      protocol: 'minmo',
      mip: 'MIP-02',
      type: 'agent_profile',
      version: '0.1.0',
      agent: {
        name: agent.name,
        pubkey: agent.pubkey,
        currency: agent.currency,
        payment_method: agent.payment_method,
        liquidity
      },
      implementation_assumption:
        'MIP-02 kind and exact content schema are configurable until canonical Minmo/Pontmore values are available.'
    })
  };
}
