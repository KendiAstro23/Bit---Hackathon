import {
  end,
  renderAccountCreated,
  renderAccountMenu,
  renderActivity,
  renderConfirmNewPasswordPrompt,
  renderConfirmPasswordPrompt,
  renderContactSupport,
  renderCreateSwapConfirm,
  renderCurrentPasswordPrompt,
  renderDashboard,
  renderDisputed,
  renderDisputeReasons,
  renderError,
  renderFaq,
  renderHelpMenu,
  renderHowMinmoWorks,
  renderLoginPasswordPrompt,
  renderLogout,
  renderMainMenu,
  renderMarkSentConfirm,
  renderMpesaPrompt,
  renderNamePrompt,
  renderNewPasswordPrompt,
  renderOtpPrompt,
  renderPasswordChanged,
  renderPasswordPrompt,
  renderPaymentConfirmed,
  renderProfile,
  renderRecipientPrompt,
  renderSwapDetail,
  renderSwapLinkSent,
  renderSwapList,
  renderSwapRequestsMenu,
  renderTransactionCancelled
} from './menus.js';
import {
  authenticateAgent,
  changeAgentPassword,
  createPendingAgent,
  findAgentByMpesa,
  findAgentByPhone,
  publishAgentDefinition,
  requestSignupOtp,
  setAgentPassword,
  validateMpesaNumber,
  validateName,
  validatePassword,
  verifySignupOtp
} from './services/agents.js';
import {
  countCompletedSwaps,
  countDisputedSwaps,
  countOpenSwaps,
  createSwapRequest,
  getSwapById,
  getSwapStats,
  listCompletedSwaps,
  listDisputedSwaps,
  listOpenSwaps,
  markPaymentSent,
  raiseDispute
} from './services/swaps.js';

const SESSION_TIMEOUT_MS = Number(process.env.USSD_SESSION_TIMEOUT_MS || 5 * 60 * 1000);
const PAGE_SIZE = Number(process.env.USSD_PAGE_SIZE || 3);

// Documented USSD states for the Minmo account, login, swap, account, and help flows.
const STATES = {
  START: 'START',
  MAIN_MENU: 'MAIN_MENU',
  CREATE_NAME: 'CREATE_NAME',
  CREATE_MPESA: 'CREATE_MPESA',
  CREATE_VERIFY_OTP: 'CREATE_VERIFY_OTP',
  CREATE_PASSWORD: 'CREATE_PASSWORD',
  CREATE_CONFIRM_PASSWORD: 'CREATE_CONFIRM_PASSWORD',
  CONTINUE_MPESA: 'CONTINUE_MPESA',
  LOGIN_MPESA: 'LOGIN_MPESA',
  LOGIN_PASSWORD: 'LOGIN_PASSWORD',
  DASHBOARD: 'DASHBOARD',
  SWAPS_MENU: 'SWAPS_MENU',
  CREATE_SWAP_RECIPIENT: 'CREATE_SWAP_RECIPIENT',
  CREATE_SWAP_CONFIRM: 'CREATE_SWAP_CONFIRM',
  SWAP_LINK_SENT: 'SWAP_LINK_SENT',
  PENDING_SWAPS: 'PENDING_SWAPS',
  COMPLETED_SWAPS: 'COMPLETED_SWAPS',
  DISPUTE_SWAP_PICK: 'DISPUTE_SWAP_PICK',
  SWAP_DETAIL: 'SWAP_DETAIL',
  MARK_SENT_CONFIRM: 'MARK_SENT_CONFIRM',
  DISPUTE_REASON: 'DISPUTE_REASON',
  ACCOUNT_MENU: 'ACCOUNT_MENU',
  PROFILE: 'PROFILE',
  ACTIVITY: 'ACTIVITY',
  CHANGE_PASSWORD_CURRENT: 'CHANGE_PASSWORD_CURRENT',
  CHANGE_PASSWORD_NEW: 'CHANGE_PASSWORD_NEW',
  CHANGE_PASSWORD_CONFIRM: 'CHANGE_PASSWORD_CONFIRM',
  HELP_MENU: 'HELP_MENU'
};

const DISPUTE_REASONS = {
  1: 'Wrong Number',
  2: 'User Unreachable',
  3: 'Payment Failed'
};

function parseData(row) {
  if (!row?.data_json) return {};
  try {
    return JSON.parse(row.data_json);
  } catch {
    return {};
  }
}

function latestInput(text = '', lastText = '') {
  if (!text) return '';
  if (text === lastText) return '';
  const current = text.split('*');
  const previous = lastText ? lastText.split('*') : [];
  return current.length > previous.length ? current[current.length - 1].trim() : '';
}

function isExpired(row) {
  if (!row?.updated_at) return false;
  return Date.now() - new Date(row.updated_at).getTime() > SESSION_TIMEOUT_MS;
}

export async function getOrCreateSession(db, sessionId, phone) {
  const existing = await db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  if (existing && !isExpired(existing)) return { ...existing, data: parseData(existing) };
  if (existing) await clearSession(db, sessionId);

  const data = existing ? { __expired: true } : {};
  await db.run(
    'INSERT INTO sessions (session_id, phone, state, data_json) VALUES (?, ?, ?, ?)',
    [sessionId, validateTransportPhone(phone), STATES.START, JSON.stringify(data)]
  );
  const created = await db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  return { ...created, data: parseData(created) };
}

export async function saveSession(db, session) {
  await db.run(
    `UPDATE sessions
     SET state = ?, data_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE session_id = ?`,
    [session.state, JSON.stringify(session.data || {}), session.session_id]
  );
}

export async function clearSession(db, sessionId) {
  await db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
}

function validateTransportPhone(phone) {
  return String(phone || '').replace(/\s+/g, '') || 'unknown';
}

function withInputTracking(session, text, result) {
  session.data = { ...(session.data || {}), __last_text: text || '' };
  return result;
}

async function finish(db, session, result) {
  await clearSession(db, session.session_id);
  return result;
}

async function persist(db, session, text, result) {
  withInputTracking(session, text, result);
  await saveSession(db, session);
  return result;
}

async function currentAgent(db, session) {
  if (!session.data?.agent_phone) return null;
  return findAgentByPhone(db, session.data.agent_phone);
}

function selectMenu(input, max) {
  const choice = Number(input);
  return Number.isInteger(choice) && choice >= 1 && choice <= max ? choice : null;
}

async function startOtp(db, otpSender, agent) {
  await requestSignupOtp(db, agent, otpSender);
  return findAgentByPhone(db, agent.phone);
}

async function completeSignup(db, relayPublisher, session) {
  const agent = await findAgentByPhone(db, session.data.signup_phone);
  const updated = await setAgentPassword(db, agent, session.data.password);
  await publishAgentDefinition(db, relayPublisher, updated, { includeEscrow: true });
  return updated;
}

async function renderPagedSwaps(db, session, agent, title, listFn, countFn, state, page = 0, error) {
  const total = await countFn(db, agent);
  const swaps = await listFn(db, agent, { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  session.state = state;
  session.data.page = page;
  session.data.swap_ids = swaps.map((swap) => swap.swap_id);
  return renderSwapList(title, swaps, { page, pageSize: PAGE_SIZE, total, error });
}

async function handlePagedList({ db, session, text, input, agent, title, listFn, countFn, state }) {
  if (input === '0') {
    session.state = STATES.SWAPS_MENU;
    return persist(db, session, text, renderSwapRequestsMenu());
  }
  if (input === '9') {
    const total = await countFn(db, agent);
    const nextPage = Number(session.data.page || 0) + 1;
    if (nextPage * PAGE_SIZE < total) {
      return persist(db, session, text, await renderPagedSwaps(db, session, agent, title, listFn, countFn, state, nextPage));
    }
    return persist(db, session, text, await renderPagedSwaps(db, session, agent, title, listFn, countFn, state, session.data.page || 0, 'Invalid selection.'));
  }
  if (input === '8') {
    const previousPage = Math.max(0, Number(session.data.page || 0) - 1);
    return persist(db, session, text, await renderPagedSwaps(db, session, agent, title, listFn, countFn, state, previousPage));
  }
  const choice = selectMenu(input, PAGE_SIZE);
  const swapId = choice ? session.data.swap_ids?.[choice - 1] : null;
  if (!swapId) {
    return persist(db, session, text, await renderPagedSwaps(db, session, agent, title, listFn, countFn, state, session.data.page || 0, 'Invalid selection.'));
  }
  const swap = await getSwapById(db, swapId);
  session.state = state === STATES.DISPUTE_SWAP_PICK ? STATES.DISPUTE_REASON : STATES.SWAP_DETAIL;
  session.data.selected_swap_id = swapId;
  return persist(db, session, text, state === STATES.DISPUTE_SWAP_PICK ? renderDisputeReasons() : renderSwapDetail(swap));
}

async function activityStats(db, agent) {
  const stats = await getSwapStats(db, agent);
  const completed = await countCompletedSwaps(db, agent);
  const disputes = await countDisputedSwaps(db, agent);
  const denominator = completed + disputes;
  return {
    completed,
    pending: stats.pending,
    disputes,
    successRate: denominator === 0 ? 100 : Math.round((completed / denominator) * 100)
  };
}

export async function handleUssdSession({ db, relayPublisher, sessionId, phone, text = '', logger = console }) {
  const session = await getOrCreateSession(db, sessionId, phone);
  const input = session.data.__expired ? '' : latestInput(text, session.data.__last_text);
  const timeoutMessage = session.data.__expired ? 'Session expired. Start again.' : undefined;
  if (session.data.__expired) delete session.data.__expired;

  const otpSender = {
    async sendOtp({ phone: targetPhone, otp }) {
      logger.info?.({ phone: targetPhone, otp }, 'Generated Minmo OTP');
    }
  };

  try {
    if (session.state === STATES.START) {
      session.state = STATES.MAIN_MENU;
      return persist(db, session, text, renderMainMenu(timeoutMessage));
    }

    const agent = await currentAgent(db, session);

    switch (session.state) {
      case STATES.MAIN_MENU: {
        const choice = selectMenu(input, 4);
        if (choice === 1) {
          session.state = STATES.CREATE_NAME;
          return persist(db, session, text, renderNamePrompt());
        }
        if (choice === 2) {
          session.state = STATES.LOGIN_MPESA;
          return persist(db, session, text, renderMpesaPrompt());
        }
        if (choice === 3) {
          session.state = STATES.CONTINUE_MPESA;
          return persist(db, session, text, renderMpesaPrompt());
        }
        if (choice === 4) {
          session.state = STATES.HELP_MENU;
          session.data.return_state = STATES.MAIN_MENU;
          return persist(db, session, text, renderHelpMenu());
        }
        return persist(db, session, text, renderMainMenu('Invalid selection.'));
      }

      case STATES.CREATE_NAME:
        try {
          session.data.signup_name = validateName(input);
          session.state = STATES.CREATE_MPESA;
          return persist(db, session, text, renderMpesaPrompt());
        } catch (error) {
          return persist(db, session, text, renderNamePrompt(error.message));
        }

      case STATES.CREATE_MPESA:
        try {
          const signupPhone = validateMpesaNumber(input);
          const pending = await createPendingAgent(db, { phone: signupPhone, name: session.data.signup_name });
          await startOtp(db, otpSender, pending);
          session.data.signup_phone = signupPhone;
          session.state = STATES.CREATE_VERIFY_OTP;
          return persist(db, session, text, renderOtpPrompt());
        } catch (error) {
          return persist(db, session, text, renderMpesaPrompt(error.message));
        }

      case STATES.CONTINUE_MPESA:
        try {
          const signupPhone = validateMpesaNumber(input);
          const pending = await findAgentByPhone(db, signupPhone);
          if (!pending) return persist(db, session, text, renderMpesaPrompt('Signup not found.'));
          if (pending.signup_status === 'active') return persist(db, session, text, renderMpesaPrompt('Account already active. Login instead.'));
          session.data.signup_phone = signupPhone;
          if (pending.signup_status === 'pending_password' || pending.otp_verified_at) {
            session.state = STATES.CREATE_PASSWORD;
            return persist(db, session, text, renderPasswordPrompt());
          }
          await startOtp(db, otpSender, pending);
          session.state = STATES.CREATE_VERIFY_OTP;
          return persist(db, session, text, renderOtpPrompt());
        } catch (error) {
          return persist(db, session, text, renderMpesaPrompt(error.message));
        }

      case STATES.CREATE_VERIFY_OTP:
        try {
          const pending = await findAgentByPhone(db, session.data.signup_phone);
          await verifySignupOtp(db, pending, input);
          session.state = STATES.CREATE_PASSWORD;
          return persist(db, session, text, renderPasswordPrompt());
        } catch (error) {
          return persist(db, session, text, renderOtpPrompt(error.message));
        }

      case STATES.CREATE_PASSWORD:
        try {
          session.data.password = validatePassword(input);
          session.state = STATES.CREATE_CONFIRM_PASSWORD;
          return persist(db, session, text, renderConfirmPasswordPrompt());
        } catch (error) {
          return persist(db, session, text, renderPasswordPrompt(error.message));
        }

      case STATES.CREATE_CONFIRM_PASSWORD:
        try {
          if (validatePassword(input) !== session.data.password) throw new Error('Passwords do not match.');
          const created = await completeSignup(db, relayPublisher, session);
          return finish(db, session, renderAccountCreated(created));
        } catch (error) {
          return persist(db, session, text, renderConfirmPasswordPrompt(error.message));
        }

      case STATES.LOGIN_MPESA:
        try {
          session.data.login_phone = validateMpesaNumber(input);
          session.state = STATES.LOGIN_PASSWORD;
          return persist(db, session, text, renderLoginPasswordPrompt());
        } catch (error) {
          return persist(db, session, text, renderMpesaPrompt(error.message));
        }

      case STATES.LOGIN_PASSWORD:
        try {
          const loggedIn = await authenticateAgent(db, session.data.login_phone, input);
          session.data.agent_phone = loggedIn.phone;
          session.state = STATES.DASHBOARD;
          return persist(db, session, text, renderDashboard(loggedIn));
        } catch (error) {
          return persist(db, session, text, renderLoginPasswordPrompt(error.message));
        }

      case STATES.DASHBOARD: {
        if (!agent) {
          session.state = STATES.MAIN_MENU;
          return persist(db, session, text, renderMainMenu('Login required.'));
        }
        const choice = selectMenu(input, 4);
        if (choice === 1) {
          session.state = STATES.SWAPS_MENU;
          return persist(db, session, text, renderSwapRequestsMenu());
        }
        if (choice === 2) {
          session.state = STATES.ACCOUNT_MENU;
          return persist(db, session, text, renderAccountMenu());
        }
        if (choice === 3) {
          session.state = STATES.HELP_MENU;
          session.data.return_state = STATES.DASHBOARD;
          return persist(db, session, text, renderHelpMenu());
        }
        if (choice === 4) return finish(db, session, renderLogout());
        return persist(db, session, text, renderDashboard(agent, 'Invalid selection.'));
      }

      case STATES.SWAPS_MENU: {
        if (!agent) return finish(db, session, renderError('login required'));
        const choice = selectMenu(input, 5);
        if (choice === 1) {
          session.state = STATES.CREATE_SWAP_RECIPIENT;
          return persist(db, session, text, renderRecipientPrompt());
        }
        if (choice === 2) {
          return persist(db, session, text, await renderPagedSwaps(db, session, agent, 'Pending Swaps', listOpenSwaps, countOpenSwaps, STATES.PENDING_SWAPS));
        }
        if (choice === 3) {
          return persist(db, session, text, await renderPagedSwaps(db, session, agent, 'Completed Swaps', listCompletedSwaps, countCompletedSwaps, STATES.COMPLETED_SWAPS));
        }
        if (choice === 4) {
          return persist(db, session, text, await renderPagedSwaps(db, session, agent, 'Select Swap for Dispute', listOpenSwaps, countOpenSwaps, STATES.DISPUTE_SWAP_PICK));
        }
        if (choice === 5) {
          session.state = STATES.DASHBOARD;
          return persist(db, session, text, renderDashboard(agent));
        }
        return persist(db, session, text, renderSwapRequestsMenu('Invalid selection.'));
      }

      case STATES.CREATE_SWAP_RECIPIENT:
        try {
          session.data.recipient = validateMpesaNumber(input);
          session.state = STATES.CREATE_SWAP_CONFIRM;
          return persist(db, session, text, renderCreateSwapConfirm(session.data.recipient));
        } catch (error) {
          return persist(db, session, text, renderRecipientPrompt(error.message));
        }

      case STATES.CREATE_SWAP_CONFIRM: {
        const choice = selectMenu(input, 2);
        if (choice === 1) {
          await createSwapRequest(db, agent, { recipient: session.data.recipient });
          session.state = STATES.SWAP_LINK_SENT;
          return persist(db, session, text, renderSwapLinkSent());
        }
        if (choice === 2) return finish(db, session, renderTransactionCancelled());
        return persist(db, session, text, renderCreateSwapConfirm(session.data.recipient));
      }

      case STATES.SWAP_LINK_SENT: {
        const choice = selectMenu(input, 3);
        if (choice === 1) {
          session.state = STATES.CREATE_SWAP_RECIPIENT;
          return persist(db, session, text, renderRecipientPrompt());
        }
        if (choice === 2) {
          session.state = STATES.SWAPS_MENU;
          return persist(db, session, text, renderSwapRequestsMenu());
        }
        if (choice === 3) return finish(db, session, end('Goodbye.'));
        return persist(db, session, text, renderSwapLinkSent());
      }

      case STATES.PENDING_SWAPS:
        return handlePagedList({ db, session, text, input, agent, title: 'Pending Swaps', listFn: listOpenSwaps, countFn: countOpenSwaps, state: STATES.PENDING_SWAPS });

      case STATES.COMPLETED_SWAPS:
        return handlePagedList({ db, session, text, input, agent, title: 'Completed Swaps', listFn: listCompletedSwaps, countFn: countCompletedSwaps, state: STATES.COMPLETED_SWAPS });

      case STATES.DISPUTE_SWAP_PICK:
        return handlePagedList({ db, session, text, input, agent, title: 'Select Swap for Dispute', listFn: listOpenSwaps, countFn: countOpenSwaps, state: STATES.DISPUTE_SWAP_PICK });

      case STATES.SWAP_DETAIL: {
        const swap = await getSwapById(db, session.data.selected_swap_id);
        const choice = selectMenu(input, 3);
        if (choice === 1) {
          session.state = STATES.MARK_SENT_CONFIRM;
          return persist(db, session, text, renderMarkSentConfirm(swap));
        }
        if (choice === 2) {
          session.state = STATES.DISPUTE_REASON;
          return persist(db, session, text, renderDisputeReasons());
        }
        if (choice === 3) {
          return persist(db, session, text, await renderPagedSwaps(db, session, agent, 'Pending Swaps', listOpenSwaps, countOpenSwaps, STATES.PENDING_SWAPS, session.data.page || 0));
        }
        return persist(db, session, text, renderSwapDetail(swap, 'Invalid selection.'));
      }

      case STATES.MARK_SENT_CONFIRM: {
        const choice = selectMenu(input, 2);
        if (choice === 1) {
          await markPaymentSent(db, relayPublisher, agent, session.data.selected_swap_id);
          return finish(db, session, renderPaymentConfirmed());
        }
        if (choice === 2) return finish(db, session, renderTransactionCancelled());
        return persist(db, session, text, renderMarkSentConfirm(await getSwapById(db, session.data.selected_swap_id)));
      }

      case STATES.DISPUTE_REASON: {
        if (input === '0') {
          session.state = STATES.SWAPS_MENU;
          return persist(db, session, text, renderSwapRequestsMenu());
        }
        const reason = DISPUTE_REASONS[Number(input)];
        if (!reason) return persist(db, session, text, renderDisputeReasons('Invalid selection.'));
        await raiseDispute(db, relayPublisher, agent, session.data.selected_swap_id, reason);
        return finish(db, session, renderDisputed());
      }

      case STATES.ACCOUNT_MENU: {
        const choice = selectMenu(input, 4);
        if (choice === 1) {
          session.state = STATES.PROFILE;
          return persist(db, session, text, renderProfile(agent));
        }
        if (choice === 2) {
          session.state = STATES.ACTIVITY;
          return persist(db, session, text, renderActivity(await activityStats(db, agent)));
        }
        if (choice === 3) {
          session.state = STATES.CHANGE_PASSWORD_CURRENT;
          return persist(db, session, text, renderCurrentPasswordPrompt());
        }
        if (choice === 4) {
          session.state = STATES.DASHBOARD;
          return persist(db, session, text, renderDashboard(agent));
        }
        return persist(db, session, text, renderAccountMenu('Invalid selection.'));
      }

      case STATES.PROFILE:
      case STATES.ACTIVITY:
        if (input === '0') {
          session.state = STATES.ACCOUNT_MENU;
          return persist(db, session, text, renderAccountMenu());
        }
        return persist(db, session, text, session.state === STATES.PROFILE ? renderProfile(agent) : renderActivity(await activityStats(db, agent)));

      case STATES.CHANGE_PASSWORD_CURRENT:
        try {
          validatePassword(input);
          session.data.current_password = input;
          session.state = STATES.CHANGE_PASSWORD_NEW;
          return persist(db, session, text, renderNewPasswordPrompt());
        } catch (error) {
          return persist(db, session, text, renderCurrentPasswordPrompt(error.message));
        }

      case STATES.CHANGE_PASSWORD_NEW:
        try {
          session.data.new_password = validatePassword(input);
          session.state = STATES.CHANGE_PASSWORD_CONFIRM;
          return persist(db, session, text, renderConfirmNewPasswordPrompt());
        } catch (error) {
          return persist(db, session, text, renderNewPasswordPrompt(error.message));
        }

      case STATES.CHANGE_PASSWORD_CONFIRM:
        try {
          if (validatePassword(input) !== session.data.new_password) throw new Error('Passwords do not match.');
          await changeAgentPassword(db, agent, session.data.current_password, session.data.new_password);
          return finish(db, session, renderPasswordChanged());
        } catch (error) {
          return persist(db, session, text, renderConfirmNewPasswordPrompt(error.message));
        }

      case STATES.HELP_MENU: {
        if (input === '0') {
          const returnState = session.data.return_state || STATES.MAIN_MENU;
          session.state = returnState;
          return persist(db, session, text, returnState === STATES.DASHBOARD && agent ? renderDashboard(agent) : renderMainMenu());
        }
        const choice = selectMenu(input, 3);
        if (choice === 1) return finish(db, session, renderHowMinmoWorks());
        if (choice === 2) return finish(db, session, renderContactSupport());
        if (choice === 3) return finish(db, session, renderFaq());
        return persist(db, session, text, renderHelpMenu('Invalid selection.'));
      }

      default:
        session.state = STATES.MAIN_MENU;
        return persist(db, session, text, renderMainMenu());
    }
  } catch (error) {
    logger.error?.({ error, sessionId, phone }, 'USSD session failed');
    return finish(db, session, renderError(error.message));
  }
}

export { STATES };
