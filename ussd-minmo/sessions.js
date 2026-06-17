import {
  renderAbout,
  renderAccount,
  renderCurrencyMenu,
  renderError,
  renderFloatConfirm,
  renderHelp,
  renderHome,
  renderLiquidityPrompt,
  renderNamePrompt,
  renderNewUserMenu,
  renderPaymentMenu,
  renderPublicKey,
  renderRegistrationConfirm,
  renderSwapDetail,
  renderSwapList,
  end
} from './menus.js';
import {
  CURRENCIES,
  PAYMENT_METHODS,
  findAgentByPhone,
  normalizePhone,
  registerAgent,
  selectByMenuIndex,
  updateLiquidity,
  validateLiquidity,
  validateName
} from './services/agents.js';
import { getSwapStats, listPendingSwaps, markPaymentSent, raiseDispute } from './services/swaps.js';

const STATES = {
  START: 'START',
  NEW_USER: 'NEW_USER',
  REGISTER_NAME: 'REGISTER_NAME',
  REGISTER_CURRENCY: 'REGISTER_CURRENCY',
  REGISTER_PAYMENT: 'REGISTER_PAYMENT',
  REGISTER_LIQUIDITY: 'REGISTER_LIQUIDITY',
  REGISTER_CONFIRM: 'REGISTER_CONFIRM',
  HOME: 'HOME',
  SWAPS_LIST: 'SWAPS_LIST',
  SWAP_DETAIL: 'SWAP_DETAIL',
  FLOAT_AMOUNT: 'FLOAT_AMOUNT',
  FLOAT_CONFIRM: 'FLOAT_CONFIRM',
  ACCOUNT: 'ACCOUNT'
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

export async function getOrCreateSession(db, sessionId, phone) {
  const existing = await db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  if (existing) return { ...existing, data: parseData(existing) };

  await db.run(
    'INSERT INTO sessions (session_id, phone, state, data_json) VALUES (?, ?, ?, ?)',
    [sessionId, normalizePhone(phone), STATES.START, '{}']
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

// Reusable USSD state machine. Routes supply transport details; this module
// owns session progression and delegates business operations to services.
export async function handleUssdSession({ db, relayPublisher, sessionId, phone, text = '', logger = console }) {
  const session = await getOrCreateSession(db, sessionId, phone);
  const input = latestInput(text, session.data.__last_text);
  const agent = await findAgentByPhone(db, phone);

  try {
    if (session.state === STATES.START) {
      session.state = agent ? STATES.HOME : STATES.NEW_USER;
      if (!input) {
        return persist(db, session, text, agent ? renderHome(agent) : renderNewUserMenu());
      }
    }

    switch (session.state) {
      case STATES.NEW_USER:
        if (!input) return persist(db, session, text, renderNewUserMenu());
        if (input === '1') {
          session.state = STATES.REGISTER_NAME;
          return persist(db, session, text, renderNamePrompt());
        }
        if (input === '2') return finish(db, session, renderAbout());
        return persist(db, session, text, renderNewUserMenu());

      case STATES.REGISTER_NAME:
        try {
          session.data.name = validateName(input);
          session.state = STATES.REGISTER_CURRENCY;
          return persist(db, session, text, renderCurrencyMenu());
        } catch (error) {
          return persist(db, session, text, renderNamePrompt(error.message));
        }

      case STATES.REGISTER_CURRENCY:
        try {
          session.data.currency = selectByMenuIndex(CURRENCIES, input, 'currency');
          session.state = STATES.REGISTER_PAYMENT;
          return persist(db, session, text, renderPaymentMenu());
        } catch (error) {
          return persist(db, session, text, renderCurrencyMenu(error.message));
        }

      case STATES.REGISTER_PAYMENT:
        try {
          session.data.payment_method = selectByMenuIndex(PAYMENT_METHODS, input, 'payment method');
          session.state = STATES.REGISTER_LIQUIDITY;
          return persist(db, session, text, renderLiquidityPrompt());
        } catch (error) {
          return persist(db, session, text, renderPaymentMenu(error.message));
        }

      case STATES.REGISTER_LIQUIDITY:
        try {
          session.data.liquidity = validateLiquidity(input);
          session.state = STATES.REGISTER_CONFIRM;
          return persist(db, session, text, renderRegistrationConfirm(session.data));
        } catch (error) {
          return persist(db, session, text, renderLiquidityPrompt(error.message));
        }

      case STATES.REGISTER_CONFIRM:
        if (input === '1') {
          const result = await registerAgent(db, relayPublisher, {
            phone,
            name: session.data.name,
            currency: session.data.currency,
            payment_method: session.data.payment_method,
            liquidity: session.data.liquidity
          });
          return finish(db, session, end(`Registered successfully.\nPubkey: ${result.agent.pubkey.slice(0, 16)}...\nNostr event: ${result.event.id.slice(0, 16)}...`));
        }
        if (input === '2') return finish(db, session, end('Registration cancelled.'));
        return persist(db, session, text, renderRegistrationConfirm(session.data));

      case STATES.HOME:
        if (!agent) {
          session.state = STATES.NEW_USER;
          return persist(db, session, text, renderNewUserMenu());
        }
        if (!input) return persist(db, session, text, renderHome(agent));
        if (input === '1') {
          const swaps = await listPendingSwaps(db, agent);
          session.state = STATES.SWAPS_LIST;
          session.data.swaps = swaps.map((swap) => swap.swap_id);
          return persist(db, session, text, renderSwapList(swaps));
        }
        if (input === '2') {
          session.state = STATES.FLOAT_AMOUNT;
          return persist(db, session, text, renderLiquidityPrompt());
        }
        if (input === '3') {
          const stats = await getSwapStats(db, agent);
          session.state = STATES.ACCOUNT;
          return persist(db, session, text, renderAccount(agent, stats));
        }
        if (input === '4') return finish(db, session, renderHelp());
        return persist(db, session, text, renderHome(agent));

      case STATES.SWAPS_LIST: {
        if (input === '0') {
          session.state = STATES.HOME;
          return persist(db, session, text, renderHome(agent));
        }
        const choice = Number(input);
        const swapId = session.data.swaps?.[choice - 1];
        if (!Number.isInteger(choice) || !swapId) {
          const swaps = await listPendingSwaps(db, agent);
          session.data.swaps = swaps.map((swap) => swap.swap_id);
          return persist(db, session, text, renderSwapList(swaps));
        }
        const swap = await db.get('SELECT * FROM swaps WHERE swap_id = ?', [swapId]);
        session.state = STATES.SWAP_DETAIL;
        session.data.selected_swap_id = swapId;
        return persist(db, session, text, renderSwapDetail(swap));
      }

      case STATES.SWAP_DETAIL:
        if (input === '0') {
          const swaps = await listPendingSwaps(db, agent);
          session.state = STATES.SWAPS_LIST;
          session.data.swaps = swaps.map((swap) => swap.swap_id);
          return persist(db, session, text, renderSwapList(swaps));
        }
        if (input === '1') {
          const published = await markPaymentSent(db, relayPublisher, agent, session.data.selected_swap_id);
          return finish(db, session, end(`Payment marked sent.\nEvent: ${published.event.id.slice(0, 16)}...`));
        }
        if (input === '2') {
          const published = await raiseDispute(db, relayPublisher, agent, session.data.selected_swap_id);
          return finish(db, session, end(`Dispute raised.\nEvent: ${published.event.id.slice(0, 16)}...`));
        }
        return persist(db, session, text, renderSwapDetail(await db.get('SELECT * FROM swaps WHERE swap_id = ?', [session.data.selected_swap_id])));

      case STATES.FLOAT_AMOUNT:
        try {
          session.data.new_liquidity = validateLiquidity(input);
          session.state = STATES.FLOAT_CONFIRM;
          return persist(db, session, text, renderFloatConfirm(agent, session.data.new_liquidity));
        } catch (error) {
          return persist(db, session, text, renderLiquidityPrompt(error.message));
        }

      case STATES.FLOAT_CONFIRM:
        if (input === '1') {
          const result = await updateLiquidity(db, relayPublisher, agent, session.data.new_liquidity);
          return finish(db, session, end(`Float updated to ${result.agent.currency} ${result.agent.liquidity}.\nEvent: ${result.event.id.slice(0, 16)}...`));
        }
        if (input === '2') return finish(db, session, end('Float update cancelled.'));
        return persist(db, session, text, renderFloatConfirm(agent, session.data.new_liquidity));

      case STATES.ACCOUNT:
        if (input === '1') return finish(db, session, renderPublicKey(agent));
        if (input === '0') {
          session.state = STATES.HOME;
          return persist(db, session, text, renderHome(agent));
        }
        return persist(db, session, text, renderAccount(agent, await getSwapStats(db, agent)));

      default:
        session.state = agent ? STATES.HOME : STATES.NEW_USER;
        return persist(db, session, text, agent ? renderHome(agent) : renderNewUserMenu());
    }
  } catch (error) {
    logger.error?.({ error, sessionId, phone }, 'USSD session failed');
    return finish(db, session, renderError(error.message));
  }
}

export { STATES };
