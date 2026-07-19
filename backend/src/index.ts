// IMPORTANT: import config FIRST so .env is loaded before any other module
// reads process.env at module-load time (e.g. webhook.ts has a const VERIFY_TOKEN
// that's set when the file is first imported).
import './config';

import express from 'express';
import path from 'path';
import webhookRouter from './routes/webhook';
import demoRouter from './routes/demo';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'halo-backend' });
});

// Serve the demo chat widget as a static page (jury demo / local testing
// without going through Meta's test-mode UX).
app.use('/demo', express.static(path.join(__dirname, '..', 'public')));

app.use(webhookRouter);
app.use(demoRouter);

app.listen(PORT, () => {
  console.log(`Halo backend running on port ${PORT}`);
  console.log(`Demo chat widget:  http://localhost:${PORT}/demo/demo.html`);
});