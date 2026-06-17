import WebSocket from 'ws';

function parseRelayList(value = process.env.NOSTR_RELAYS || '') {
  return value
    .split(',')
    .map((relay) => relay.trim())
    .filter(Boolean);
}

function publishOne(relayUrl, event, timeoutMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(relayUrl);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ relay: relayUrl, ok: false, message: 'relay publish timeout' });
    }, timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify(['EVENT', event]));
    });

    ws.on('message', (message) => {
      try {
        const payload = JSON.parse(message.toString());
        if (payload[0] === 'OK' && payload[1] === event.id) {
          clearTimeout(timer);
          ws.close();
          resolve({ relay: relayUrl, ok: Boolean(payload[2]), message: payload[3] || '' });
        }
      } catch (error) {
        clearTimeout(timer);
        ws.close();
        resolve({ relay: relayUrl, ok: false, message: error.message });
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timer);
      resolve({ relay: relayUrl, ok: false, message: error.message });
    });

    ws.on('close', () => clearTimeout(timer));
  });
}

// Relay abstraction used by services. It publishes the same signed event to all
// configured relays and returns per-relay delivery results for audit logging.
export class RelayPublisher {
  constructor({ relays = parseRelayList(), timeoutMs = Number(process.env.RELAY_PUBLISH_TIMEOUT_MS || 5000), logger = console } = {}) {
    this.relays = relays;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  async publish(event) {
    if (this.relays.length === 0) {
      this.logger.warn?.('No Nostr relays configured; event was signed but not published');
      return [];
    }

    const results = await Promise.all(this.relays.map((relay) => publishOne(relay, event, this.timeoutMs)));
    const accepted = results.filter((result) => result.ok).length;
    this.logger.info?.({ event_id: event.id, accepted, attempted: results.length }, 'Published Nostr event');
    return results;
  }
}

export function createRelayPublisher(options = {}) {
  return new RelayPublisher(options);
}
