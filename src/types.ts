/**
 * WebSocket Message Types
 */

// Client Types
export type ClientType = "mobile" | "dashboard" | "ml-service";

// Message Types that can be produced/consumed
export type MessageType = "video-frame" | "alert";

// Client Metadata
export interface ClientMetadata {
  userId: string; // Now required - authenticated user ID
  sessionId: string; // Better Auth session ID
  userEmail?: string; // Optional user email
  userName?: string; // Optional user name
  streamId: string;
  clientType: ClientType;
  produces: MessageType[];
  consumes: MessageType[];
  connectedAt: Date;
}

// Base Message
interface BaseMessage {
  type: string;
  timestamp?: number;
}

// Client Registration Message
export interface RegisterMessage extends BaseMessage {
  type: "register";
  clientType: ClientType;
  streamId: string;
  produces?: MessageType[];
  consumes?: MessageType[];
  // Note: userId and token are no longer needed in messages
  // Authentication is handled during WebSocket upgrade
}

// Client Subscribe Message (for consumers)
export interface SubscribeMessage extends BaseMessage {
  type: "subscribe";
  clientType: ClientType;
  streamId: string;
  consumes: MessageType[];
  // Note: userId and token are no longer needed in messages
  // Authentication is handled during WebSocket upgrade
}

// Video Frame Message (from Mobile to Dashboard/ML)
export interface VideoFrameMessage extends BaseMessage {
  type: "video-frame";
  streamId: string;
  data: string | ArrayBuffer; // base64 or binary
  timestamp: number;
}

// Alert Message (from ML Service to Mobile/Dashboard)
export interface AlertMessage extends BaseMessage {
  type: "alert";
  streamId: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  metadata?: {
    confidence: number;
    location?: { x: number; y: number };
    objectType?: string;
    [key: string]: any;
  };
  timestamp: number;
}

// Authentication Message
export interface AuthMessage extends BaseMessage {
  type: "auth";
  token: string;
}

// Status Update Message (server to clients)
export interface StatusMessage extends BaseMessage {
  type: "status";
  streamId: string;
  status: "online" | "offline" | "streaming";
}

// Error Message (server to clients)
export interface ErrorMessage extends BaseMessage {
  type: "error";
  code: string;
  message: string;
}

// Success Message (server to clients)
export interface SuccessMessage extends BaseMessage {
  type: "success";
  message: string;
}

// Union of all messages
export type WSMessage =
  | RegisterMessage
  | SubscribeMessage
  | VideoFrameMessage
  | AlertMessage
  | AuthMessage
  | StatusMessage
  | ErrorMessage
  | SuccessMessage;
