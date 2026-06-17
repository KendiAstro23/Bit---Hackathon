import express from 'express';
import { formatUssdResponse } from '../menus.js';
import { handleUssdSession } from '../sessions.js';

function readUssdPayload(req) {
  return {
    sessionId: req.body.sessionId || req.body.session_id,
    serviceCode: req.body.serviceCode || req.body.service_code,
    phone: req.body.phoneNumber || req.body.phone,
    text: req.body.text || ''
  };
}

// Africa's Talking webhook boundary. It accepts form-encoded sandbox requests
// and returns plain-text CON/END responses expected by USSD gateways.
export function createUssdRouter({ db, relayPublisher, logger = console }) {
  const router = express.Router();

  router.post(['/', '/ussd'], async (req, res) => {
    const payload = readUssdPayload(req);
    if (!payload.sessionId || !payload.phone) {
      res.status(400).type('text/plain').send('END Missing sessionId or phoneNumber.');
      return;
    }

    const result = await handleUssdSession({
      db,
      relayPublisher,
      sessionId: payload.sessionId,
      phone: payload.phone,
      text: payload.text,
      logger
    });

    res.type('text/plain').send(formatUssdResponse(result));
  });

  return router;
}
