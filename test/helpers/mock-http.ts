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
