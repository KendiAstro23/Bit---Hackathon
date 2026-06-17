export function con(body) {
  return { terminal: false, body };
}

export function end(body) {
  return { terminal: true, body };
}

export function formatUssdResponse(result) {
  return `${result.terminal ? 'END' : 'CON'} ${result.body}`;
}

function withError(body, error) {
  return `${error ? `${error}\n` : ''}${body}`;
}

export function renderMainMenu(error) {
  return con(withError('Welcome to Minmo\n1. Create Minmo Account\n2. Login\n3. Continue Signup\n4. Help', error));
}

export function renderNamePrompt(error) {
  return con(withError('Enter Full Name:', error));
}

export function renderMpesaPrompt(error) {
  return con(withError('Enter M-Pesa Number:', error));
}

export function renderOtpPrompt(error) {
  return con(withError('Enter OTP:', error));
}

export function renderPasswordPrompt(error) {
  return con(withError('Create Password:', error));
}

export function renderConfirmPasswordPrompt(error) {
  return con(withError('Confirm Password:', error));
}

export function renderLoginPasswordPrompt(error) {
  return con(withError('Enter Password:', error));
}

export function renderAccountCreated(agent) {
  return end(`Account Created\nWelcome ${agent.name}`);
}

export function renderDashboard(agent, error) {
  return con(withError(`Welcome ${agent.name}\n1. Swap Requests\n2. Account\n3. Help\n4. Logout`, error));
}

export function renderSwapRequestsMenu(error) {
  return con(withError('Swap Requests\n1. Create Swap Link\n2. Pending Swaps\n3. Completed Swaps\n4. Disputes\n5. Back', error));
}

export function renderRecipientPrompt(error) {
  return con(withError('Enter recipient phone number:', error));
}

export function renderCreateSwapConfirm(recipient) {
  return con(`Create swap link for ${recipient}?\n1. Confirm\n2. Cancel`);
}

export function renderSwapLinkSent() {
  return con('Swap Link Sent\n1. Create Another\n2. Back\n3. Exit');
}

export function renderSwapList(title, swaps, { page = 0, pageSize = 3, total = swaps.length, error } = {}) {
  if (swaps.length === 0) return con(withError(`${title}\nNo swaps found.\n0. Back`, error));
  const rows = swaps.map((swap, index) => `${index + 1}. ${swap.from_currency} ${swap.fiat_amount}`);
  const hasNext = (page + 1) * pageSize < total;
  const hasPrev = page > 0;
  const nav = [hasNext ? '9. Next' : null, hasPrev ? '8. Previous' : null, '0. Back'].filter(Boolean);
  return con(withError(`${title}\n${rows.join('\n')}\n${nav.join('\n')}`, error));
}

export function renderSwapDetail(swap, error) {
  return con(withError(`Amount: ${swap.from_currency} ${swap.fiat_amount}\nRecipient: ${swap.counterparty || 'N/A'}\nReference: ${swap.payment_reference || 'N/A'}\n1. Mark Sent\n2. Dispute\n3. Back`, error));
}

export function renderMarkSentConfirm(swap) {
  return con(`Confirm payment sent?\n${swap.from_currency} ${swap.fiat_amount}\n1. Confirm\n2. Cancel`);
}

export function renderPaymentConfirmed() {
  return end('Payment Confirmed\nSwap Updated');
}

export function renderTransactionCancelled() {
  return end('Transaction Cancelled');
}

export function renderDisputeReasons(error) {
  return con(withError('Select dispute reason\n1. Wrong Number\n2. User Unreachable\n3. Payment Failed\n0. Back', error));
}

export function renderDisputed() {
  return end('State = Disputed');
}

export function renderAccountMenu(error) {
  return con(withError('Account\n1. Agent Profile\n2. Activity\n3. Change Password\n4. Back', error));
}

export function renderProfile(agent) {
  return con(`Agent Profile\nName: ${agent.name}\nCurrency: ${agent.currency}\nBalance: ${agent.liquidity}\nStatus: ${agent.account_status || 'active'}\n0. Back`);
}

export function renderActivity(stats) {
  return con(`Activity\nCompleted Swaps: ${stats.completed}\nPending Swaps: ${stats.pending}\nDisputes: ${stats.disputes}\nSuccess Rate: ${stats.successRate}%\n0. Back`);
}

export function renderCurrentPasswordPrompt(error) {
  return con(withError('Enter current password:', error));
}

export function renderNewPasswordPrompt(error) {
  return con(withError('Enter new password:', error));
}

export function renderConfirmNewPasswordPrompt(error) {
  return con(withError('Confirm new password:', error));
}

export function renderPasswordChanged() {
  return end('Password changed successfully.');
}

export function renderHelpMenu(error) {
  return con(withError('Help\n1. How Minmo Works\n2. Contact Support\n3. FAQ\n0. Back', error));
}

export function renderHowMinmoWorks() {
  return end('Minmo lets Agents manage swap requests over USSD while publishing verified Pontmore events to Nostr.');
}

export function renderContactSupport() {
  return end('Contact Support\nsupport@minmo.local');
}

export function renderFaq() {
  return end('FAQ\nUse your M-Pesa number and password to login. Keep OTPs private.');
}

export function renderLogout() {
  return end('Logged out.');
}

export function renderError(message) {
  return end(`Sorry, ${message || 'something went wrong'}. Try again later.`);
}
