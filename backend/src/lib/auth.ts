// ---------------------------------------------------------------------------
// Auth middleware + helpers.
//
// Uses Supabase Auth directly (no bcrypt, no custom JWT, no Passport).
// Flow:
//   1. Dashboard calls POST /api/auth/signup with {email, password, name,
//      business_name} → creates auth.users row, then a profiles row, then
//      a businesses row linked via owner_id.
//   2. Dashboard calls POST /api/auth/login → returns {access_token}
//   3. Every subsequent request sends `Authorization: Bearer <access_token>`
//   4. requireAuth middleware verifies the token, attaches user to req
//   5. requireOwnerBusiness middleware verifies req.user owns req.params.id
//
// Tokens are short-lived (Supabase default: 1 hour). Refresh handled by
// supabase-js on the frontend automatically via refresh_token cookie.
// ---------------------------------------------------------------------------

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { getSupabase } from './supabase';

export interface AuthedUser {
  id: string;
  email: string;
  businessId: string | null; // populated by requireOwnerBusiness
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
  }
}

/**
 * Extract a bearer token from the Authorization header.
 * Returns null if missing or malformed.
 */
function extractToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * Verify a Supabase JWT and return the user. Throws on failure.
 * Uses a temp Supabase client configured with the user's token so
 * getUser() verifies against the actual JWT (no service_role key needed
 * for verification — Supabase's anon key + JWT does it).
 */
export async function verifyToken(token: string): Promise<{
  id: string;
  email: string;
}> {
  // We use the same Supabase client but pass the token in the request
  // context. Supabase-js v2 supports per-request token via setSession.
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Error(error?.message || 'Invalid token');
  }
  return {
    id: data.user.id,
    email: data.user.email || '',
  };
}

/**
 * Look up which business(es) this user owns via the profiles → businesses
 * link. For MVP, we assume 1 user = 1 business.
 */
async function loadBusinessIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('loadBusinessIdForUser failed:', error.message);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Express middleware: 401 if no/bad token; otherwise attaches req.user
 * with {id, email, businessId}.
 */
export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }

  try {
    const u = await verifyToken(token);
    const businessId = await loadBusinessIdForUser(u.id);
    req.user = { ...u, businessId };
    return next();
  } catch (e) {
    return res.status(401).json({ error: (e as Error).message });
  }
};

/**
 * Express middleware: 403 if the user does not own the business in the URL.
 * Use AFTER requireAuth on routes like /api/business/:businessId/...
 */
export const requireOwnedBusiness = (paramName = 'businessId') =>
  (async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const urlBusinessId = req.params[paramName];
    if (!urlBusinessId) {
      return res.status(400).json({ error: `Missing ${paramName}` });
    }
    if (req.user.businessId !== urlBusinessId) {
      return res.status(403).json({ error: 'You do not own this business' });
    }
    return next();
  }) as RequestHandler;
