import type { Request, Response } from 'express';

export interface FakeRes {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}

export function createRes(): FakeRes & Response {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res as FakeRes & Response;
}

export function createReq(opts: {
  body?: unknown;
  headers?: Record<string, string>;
  ip?: string;
}): Request {
  return {
    body: opts.body ?? {},
    headers: opts.headers ?? {},
    ip: opts.ip ?? '127.0.0.1',
  } as unknown as Request;
}

export function uniqueCr(): string {
  // 10 digits, derived from the current time + a random tail so parallel
  // test runs never collide on the pending_applications_cr_active_uq index.
  const t = Date.now().toString().slice(-8);
  const r = Math.floor(Math.random() * 90 + 10);
  return `${t}${r}`;
}

export function uniqueEmail(): string {
  return `cp55-test-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}
