// Load .env FIRST, before any other module reads process.env.
// Import this at the TOP of index.ts, before any other imports.
import dotenv from 'dotenv';
dotenv.config();
