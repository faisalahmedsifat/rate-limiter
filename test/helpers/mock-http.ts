export interface MockExpressResponse {
  body: string | undefined;
  headers: Record<string, string>;
  jsonBody: unknown;
  status: (code: number) => MockExpressResponse;
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
  json: (body: unknown) => void;
}

export interface MockFastifyReply {
  headers: Record<string, string>;
  payload: unknown;
  statusCode: number | undefined;
  code: (statusCode: number) => MockFastifyReply;
  header: (name: string, value: string) => MockFastifyReply;
  send: (payload: unknown) => void;
}

export interface MockHonoContext {
  headers: Record<string, string>;
  json: (body: unknown, status?: number) => Response;
  req: {
    raw: Request;
    header(name: string): string | undefined;
  };
  header(name: string, value: string): void;
}

export interface MockNestResponse {
  headers: Record<string, string>;
  header(name: string, value: string): void;
  setHeader(name: string, value: string): void;
}

export function createMockExpressResponse(): MockExpressResponse {
  return {
    body: undefined,
    headers: {},
    jsonBody: undefined,
    statusCode: 200,
    setHeader(name: string, value: string): void {
      this.headers[name] = value;
    },
    status(code: number): MockExpressResponse {
      this.statusCode = code;
      return this;
    },
    end(body?: string): void {
      this.body = body;
    },
    json(body: unknown): void {
      this.jsonBody = body;
    },
  };
}

export function createMockFastifyReply(): MockFastifyReply {
  return {
    headers: {},
    payload: undefined,
    statusCode: undefined,
    code(statusCode: number): MockFastifyReply {
      this.statusCode = statusCode;
      return this;
    },
    header(name: string, value: string): MockFastifyReply {
      this.headers[name] = value;
      return this;
    },
    send(payload: unknown): void {
      this.payload = payload;
    },
  };
}

export function createMockHonoContext(request: Request): MockHonoContext {
  return {
    headers: {},
    req: {
      raw: request,
      header(name: string): string | undefined {
        return request.headers.get(name) ?? undefined;
      },
    },
    header(name: string, value: string): void {
      this.headers[name] = value;
    },
    json(body: unknown, status = 200): Response {
      return Response.json(body, { status, headers: this.headers });
    },
  };
}

export function createMockNestResponse(): MockNestResponse {
  return {
    headers: {},
    header(name: string, value: string): void {
      this.headers[name] = value;
    },
    setHeader(name: string, value: string): void {
      this.headers[name] = value;
    },
  };
}
