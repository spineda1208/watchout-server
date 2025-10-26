/**
 * Authentication utilities for WebSocket server
 * 
 * This module provides session verification using Better Auth.
 * It connects to the same database as your Next.js app to verify sessions.
 * 
 * IMPORTANT: Configure this to match your Next.js Better Auth setup.
 * You'll need to adjust the database connection based on your setup.
 */

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
    // Option 1: Query your database directly
    // This is the most straightforward approach for session verification
    // You'll need to adapt this based on your database setup (Drizzle, Prisma, etc.)
    
    // Example with Drizzle (you'll need to import your schema):
    // import { db } from "./db";
    // import { session, user } from "./schema";
    // 
    // const result = await db
    //   .select({
    //     sessionId: session.id,
    //     userId: session.userId,
    //     expiresAt: session.expiresAt,
    //     email: user.email,
    //     name: user.name,
    //   })
    //   .from(session)
    //   .leftJoin(user, eq(session.userId, user.id))
    //   .where(eq(session.token, token))
    //   .limit(1);
    //
    // if (!result[0] || new Date(result[0].expiresAt) < new Date()) {
    //   return null;
    // }
    //
    // return {
    //   userId: result[0].userId,
    //   sessionId: result[0].sessionId,
    //   user: {
    //     id: result[0].userId,
    //     email: result[0].email,
    //     name: result[0].name,
    //   },
    // };

    // Option 2: Call your Next.js API endpoint to verify the token
    // This is simpler but adds network overhead
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/auth/session`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: `better-auth.session_token=${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const session = await response.json() as any;
    
    if (!session || !session.user) {
      return null;
    }

    return {
      userId: session.user.id,
      sessionId: session.session?.id || session.user.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
    };
  } catch (error) {
    console.error("[Auth] Error verifying session:", error);
    return null;
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
