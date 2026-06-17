import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

export function hexToBytes(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Expected a 32-byte private key encoded as 64 hex characters');
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

// Nostr identity and signing helpers. All agent actions flow through this file
// before relay publication so tests can verify event shape and signatures.
export function createKeypair() {
  const secretKey = generateSecretKey();
  const privkey = bytesToHex(secretKey);
  const pubkey = getPublicKey(secretKey);
  return { privkey, pubkey };
}

export function signEvent(unsignedEvent, privkey) {
  const secretKey = hexToBytes(privkey);
  const event = {
    ...unsignedEvent,
    created_at: unsignedEvent.created_at || Math.floor(Date.now() / 1000),
    tags: unsignedEvent.tags || []
  };
  return finalizeEvent(event, secretKey);
}

export function verifySignedEvent(event) {
  return verifyEvent(event);
}
