import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import { getDb, initDb } from './db.js';
import { createRelayPublisher } from './relay.js';
import { createUssdRouter } from './routes/ussd.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use((req, _res, next) => {
  logger.info({ method: req.method, path: req.path }, 'Incoming request');
  next();
});

const db = await getDb();
await initDb(db);
const relayPublisher = createRelayPublisher({ logger });

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'Pontmore Minmo USSD' });
});

app.use('/ussd', createUssdRouter({ db, relayPublisher, logger }));
app.use('/', createUssdRouter({ db, relayPublisher, logger }));

app.use((error, _req, res, _next) => {
  logger.error({ error }, 'Unhandled request error');
  res.status(500).type('text/plain').send('END Service temporarily unavailable.');
});

app.listen(port, () => {
  logger.info({ port, db: db.filename }, 'Pontmore Minmo USSD listening');
});
