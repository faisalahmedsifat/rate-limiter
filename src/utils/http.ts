export interface HeaderCarrier {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
}

export function getDefaultKeyFromRequest(request: HeaderCarrier): string {
  const forwarded = request.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || "anonymous";
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]?.trim() || "anonymous";
  }

  return request.ip || request.socket?.remoteAddress || "anonymous";
}
