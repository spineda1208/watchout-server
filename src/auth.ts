/**
 * Authentication utilities for WebSocket server
 * 
 * This module provides session verification using Better Auth.
 * It connects to the same database as your Next.js app to verify sessions.
 */

import { db } from "./db/client";
import { session, user } from "./db/schema";
import { eq } from "drizzle-orm";
import {
  jwtVerify,
  createRemoteJWKSet,
  importSPKI,
  decodeProtectedHeader,
} from "jose";

/**
 * Verify a session token and return user info
 * 
 * This function queries your Better Auth database directly to verify sessions.
 * 
 * @param token - The session token from the client
 * @returns User info if valid, null if invalid
 */
export async function verifySessionToken(token: string): Promise<{
  userId: string;
  sessionId: string;
  user: {
    id: string;
    email?: string;
    name?: string;
  };
} | null> {
  try {
    // Query the database directly to verify the session
    const result = await db
      .select({
        sessionId: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
        email: user.email,
        name: user.name,
      })
      .from(session)
      .leftJoin(user, eq(session.userId, user.id))
      .where(eq(session.token, token))
      .limit(1);

    if (!result[0]) {
      console.log("[Auth] No session found for token");
      return null;
    }

    // Check if session has expired
    if (new Date(result[0].expiresAt) < new Date()) {
      console.log("[Auth] Session has expired");
      return null;
    }

    return {
      userId: result[0].userId,
      sessionId: result[0].sessionId,
      user: {
        id: result[0].userId,
        email: result[0].email ?? undefined,
        name: result[0].name ?? undefined,
      },
    };
  } catch (error) {
    console.error("[Auth] Error verifying session:", error);
    return null;
  }
}

/**
 * Unified token verification that supports:
 * 1) App-issued JWT (HMAC secret, public key, or JWKS URL)
 * 2) Backend introspection endpoint returning user claims
 * 3) Fallback to Better Auth DB session verification (current behavior)
 */
export async function verifyAuthToken(token: string): Promise<{
  userId: string;
  sessionId?: string;
  user: {
    id: string;
    email?: string;
    name?: string;
  };
} | null> {
  // Prefer JWT verification if configured
  const hasJwtConfig = Boolean(
    process.env.JWT_SECRET || process.env.JWT_PUBLIC_KEY || process.env.JWT_JWKS_URL,
  );

  if (hasJwtConfig) {
    const claims = await verifyJwtToken(token);
    if (claims) {
      return claims;
    }
  }

  // Next, try introspection endpoint if configured
  if (process.env.INTROSPECTION_URL) {
    const claims = await introspectToken(token);
    if (claims) {
      return claims;
    }
  }

  // Finally, fallback to Better Auth session verification
  return await verifySessionToken(token);
}

/** Internal: verify an app-issued JWT and return mapped claims */
async function verifyJwtToken(token: string): Promise<{
  userId: string;
  sessionId?: string;
  user: { id: string; email?: string; name?: string };
} | null> {
  try {
    const issuer = process.env.JWT_ISSUER;
    const audience = process.env.JWT_AUDIENCE;

    const alg = (() => {
      try {
        const header = decodeProtectedHeader(token);
        return typeof header.alg === "string" ? header.alg : undefined;
      } catch {
        return undefined;
      }
    })();

    let verifyKey: any;

    // JWKS (remote) takes precedence for rotating keys
    if (process.env.JWT_JWKS_URL) {
      const jwks = createRemoteJWKSet(new URL(process.env.JWT_JWKS_URL));
      const { payload } = await jwtVerify(token, jwks, { issuer, audience });
      return mapClaimsToUser(payload);
    }

    // Public key (PEM, SPKI)
    if (process.env.JWT_PUBLIC_KEY) {
      if (!alg) {
        console.log("[Auth] JWT header missing alg; cannot import public key");
        return null;
      }
      try {
        verifyKey = await importSPKI(process.env.JWT_PUBLIC_KEY, alg);
      } catch (e) {
        console.log("[Auth] Failed to import SPKI public key for alg", alg, e);
        return null;
      }
      const { payload } = await jwtVerify(token, verifyKey, { issuer, audience });
      return mapClaimsToUser(payload);
    }

    // Shared secret (HMAC)
    if (process.env.JWT_SECRET) {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      const { payload } = await jwtVerify(token, secret, { issuer, audience });
      return mapClaimsToUser(payload);
    }

    return null;
  } catch (error) {
    console.log("[Auth] JWT verification failed:", error);
    return null;
  }
}

/** Internal: call backend introspection endpoint and return mapped claims */
async function introspectToken(token: string): Promise<{
  userId: string;
  sessionId?: string;
  user: { id: string; email?: string; name?: string };
} | null> {
  try {
    const url = process.env.INTROSPECTION_URL!;
    const method = (process.env.INTROSPECTION_METHOD || "POST").toUpperCase();
    const tokenParam = process.env.INTROSPECTION_TOKEN_PARAM || "token";

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Optional custom auth header (name/value)
    const authHeaderName = process.env.INTROSPECTION_AUTH_HEADER_NAME;
    const authHeaderValue = process.env.INTROSPECTION_AUTH_HEADER_VALUE;
    if (authHeaderName && authHeaderValue) {
      headers[authHeaderName] = authHeaderValue;
    }

    let finalUrl = url;
    let body: string | undefined;
    if (method === "GET") {
      const u = new URL(url);
      u.searchParams.set(tokenParam, token);
      finalUrl = u.toString();
    } else {
      body = JSON.stringify({ [tokenParam]: token });
    }

    const response = await fetch(finalUrl, { method, headers, body });
    if (!response.ok) {
      console.log("[Auth] Introspection request failed:", response.status, await safeText(response));
      return null;
    }
    const data = (await response.json().catch(() => null)) as any;

    // If response has explicit active=false, consider invalid
    if (data && typeof data === "object" && "active" in data && !data.active) {
      console.log("[Auth] Introspection returned inactive token");
      return null;
    }

    const claims = data && typeof data === "object" && "claims" in data ? (data as any).claims : data;
    const mapped = mapClaimsToUser(claims);
    return mapped;
  } catch (error) {
    console.log("[Auth] Introspection error:", error);
    return null;
  }
}

function mapClaimsToUser(payload: any): {
  userId: string;
  sessionId?: string;
  user: { id: string; email?: string; name?: string };
} | null {
  if (!payload || typeof payload !== "object") return null;

  const userId =
    payload.userId ||
    payload.sub ||
    payload.uid ||
    (payload.user && payload.user.id);

  if (!userId) {
    console.log("[Auth] No userId/sub in token claims");
    return null;
  }

  const email = payload.email || (payload.user && payload.user.email);
  const name = payload.name || (payload.user && payload.user.name);
  const sessionId = payload.sid || payload.sessionId;

  return {
    userId: String(userId),
    sessionId: sessionId ? String(sessionId) : undefined,
    user: {
      id: String(userId),
      email: email ? String(email) : undefined,
      name: name ? String(name) : undefined,
    },
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Extract token from WebSocket upgrade request
 * Supports multiple methods:
 * 1. Query parameter: ?token=xxx
 * 2. Authorization header: Bearer xxx
 * 3. Cookie: better-auth.session_token=xxx
 */
export function extractTokenFromRequest(request: Request): string | null {
  // Method 1: Check query parameter
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    return queryToken;
  }

  // Method 2: Check Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // Method 3: Check cookie
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").map(c => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith("better-auth.session_token=")) {
        return cookie.substring("better-auth.session_token=".length);
      }
    }
  }

  return null;
}

/**
 * Validate that a user has access to a specific stream
 * This is a placeholder - implement your own authorization logic
 * based on your business rules
 */
export async function authorizeStreamAccess(
  userId: string,
  streamId: string,
  operation: "read" | "write"
): Promise<boolean> {
  // TODO: Implement your authorization logic here
  // For example:
  // - Check if user owns the stream
  // - Check if user has permission to view/publish to the stream
  // - Query your database for access control rules
  
  // For now, allow all authenticated users
  // In production, you should implement proper access control
  console.log(`[Auth] Authorizing ${userId} for ${operation} access to stream ${streamId}`);
  return true;
}
