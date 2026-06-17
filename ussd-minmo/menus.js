import { CURRENCIES, PAYMENT_METHODS } from './services/agents.js';

export function con(body) {
  return { terminal: false, body };
}

export function end(body) {
  return { terminal: true, body };
}

export function formatUssdResponse(result) {
  return `${result.terminal ? 'END' : 'CON'} ${result.body}`;
}

export function renderNewUserMenu() {
  return con('Minmo Agent USSD\n1. Register\n2. About Minmo');
}

export function renderAbout() {
  return end('Minmo helps Bitcoin liquidity agents coordinate swaps using signed Nostr events.');
}

export function renderNamePrompt(error) {
  return con(`${error ? `${error}\n` : ''}Enter your full name:`);
}

export function renderCurrencyMenu(error) {
  return con(`${error ? `${error}\n` : ''}Select currency:\n${CURRENCIES.map((currency, index) => `${index + 1}. ${currency}`).join('\n')}`);
}

export function renderPaymentMenu(error) {
  return con(`${error ? `${error}\n` : ''}Select payment method:\n${PAYMENT_METHODS.map((method, index) => `${index + 1}. ${method}`).join('\n')}`);
}

export function renderLiquidityPrompt(error) {
  return con(`${error ? `${error}\n` : ''}Enter available float amount:`);
}

export function renderRegistrationConfirm(data) {
  return con(`Confirm registration\n${data.name}\n${data.currency}, ${data.payment_method}\nFloat: ${data.liquidity}\n1. Confirm\n2. Cancel`);
}

export function renderHome(agent) {
  return con(`Minmo Agent\nFloat: ${agent.currency} ${agent.liquidity}\n1. Swap Requests\n2. Update Float\n3. Account\n4. Help`);
}

export function renderSwapList(swaps) {
  if (swaps.length === 0) return con('No pending swaps.\n0. Back');
  const rows = swaps.map((swap, index) => `${index + 1}. ${swap.swap_id} ${swap.from_currency} ${swap.fiat_amount}`);
  return con(`Pending swaps\n${rows.join('\n')}\n0. Back`);
}

export function renderSwapDetail(swap) {
  return con(`Swap ${swap.swap_id}\n${swap.from_currency} ${swap.fiat_amount}\nBTC sats: ${swap.btc_amount_sats}\nRef: ${swap.payment_reference || 'N/A'}\n1. Mark payment sent\n2. Raise dispute\n0. Back`);
}

export function renderFloatConfirm(agent, amount) {
  return con(`Update float from ${agent.currency} ${agent.liquidity} to ${agent.currency} ${amount}?\n1. Confirm\n2. Cancel`);
}

export function renderAccount(agent, stats) {
  return con(`Account\n${agent.name}\n${agent.currency}, ${agent.payment_method}\nFloat: ${agent.liquidity}\nSwaps: ${stats.total} total, ${stats.pending} pending\n1. Public key\n0. Back`);
}

export function renderPublicKey(agent) {
  return end(`Public key\n${agent.pubkey}`);
}

export function renderHelp() {
  return end('Use Minmo Agent USSD to manage Bitcoin swap requests. Your actions are signed and published to Nostr relays.');
}

export function renderError(message) {
  return end(`Sorry, ${message || 'something went wrong'}. Try again later.`);
}
