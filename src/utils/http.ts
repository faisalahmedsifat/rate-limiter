export interface HeaderCarrier {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: {
    remoteAddress?: string;
  };
}

export function getDefaultKeyFromHeaders(
  getHeader: (name: string) => string | null | undefined,
): string {
  const forwarded = getHeader("x-forwarded-for");
  if (forwarded && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || "anonymous";
  }

  const realIp = getHeader("x-real-ip");
  if (realIp && realIp.length > 0) {
    return realIp.trim();
  }

  const cfConnectingIp = getHeader("cf-connecting-ip");
  if (cfConnectingIp && cfConnectingIp.length > 0) {
    return cfConnectingIp.trim();
  }

  return "anonymous";
}

export function getDefaultKeyFromRequest(request: HeaderCarrier): string {
  const forwarded = request.headers?.["x-forwarded-for"];
  const realIp = request.headers?.["x-real-ip"];
  const cfConnectingIp = request.headers?.["cf-connecting-ip"];

  const key = getDefaultKeyFromHeaders((name) => {
    if (name === "x-forwarded-for") {
      if (typeof forwarded === "string") {
        return forwarded;
      }

      return forwarded?.[0];
    }

    const candidate = name === "x-real-ip" ? realIp : cfConnectingIp;
    if (typeof candidate === "string") {
      return candidate;
    }

    return candidate?.[0];
  });

  if (key !== "anonymous") {
    return key;
  }

  return request.ip || request.socket?.remoteAddress || "anonymous";
}

export function getDefaultKeyFromFetchRequest(request: Request): string {
  return getDefaultKeyFromHeaders((name) => request.headers.get(name));
}
