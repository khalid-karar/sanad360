import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Real send() reaches SES unless the capture gate diverts it — mock the SDK
// so an accidentally-unmocked "real" path in one of these cases fails loud
// (a rejected promise) instead of trying an actual network call.
const sesSendMock = vi.fn().mockRejectedValue(new Error('SES should never be reached in this test file'));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: class {
    send = sesSendMock;
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { send } = await import('./email.js');

const CAPTURE_FILE = path.join(os.tmpdir(), `email-capture-test-${process.pid}-${Date.now()}.jsonl`);
const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  process.env.E2E_CAPTURE_EMAIL_FILE = CAPTURE_FILE;
}

beforeEach(() => {
  resetEnv();
  sesSendMock.mockClear();
});

afterEach(async () => {
  resetEnv();
  await rm(CAPTURE_FILE, { force: true });
});

describe('email capture gate — triple-gated, must never fire in production', () => {
  it('captures to file instead of calling SES when all three conditions hold', async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_CAPTURE_EMAIL = '1';

    await send('applicant@example.com', 'verify', 'ar', { name: 'Test', link: 'https://example.test/verify?token=abc123' });

    expect(sesSendMock).not.toHaveBeenCalled();
    const content = await readFile(CAPTURE_FILE, 'utf8');
    const line = JSON.parse(content.trim().split('\n').pop()!);
    expect(line.to).toBe('applicant@example.com');
    expect(line.template).toBe('verify');
    expect(line.vars.link).toBe('https://example.test/verify?token=abc123');
  });

  it('does NOT capture and falls through to real send() when NODE_ENV=production, even with the flag set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.E2E_CAPTURE_EMAIL = '1';
    process.env.AWS_REGION = 'us-east-1';
    process.env.SES_FROM_EMAIL = 'noreply@example.test';

    await expect(
      send('applicant@example.com', 'verify', 'ar', { name: 'Test', link: 'https://example.test/verify?token=abc123' })
    ).rejects.toThrow('SES should never be reached in this test file');

    expect(sesSendMock).toHaveBeenCalledTimes(1);
    await expect(readFile(CAPTURE_FILE, 'utf8')).rejects.toThrow();
  });

  it('does NOT capture when E2E_CAPTURE_EMAIL is unset, even under NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.E2E_CAPTURE_EMAIL;
    process.env.AWS_REGION = 'us-east-1';
    process.env.SES_FROM_EMAIL = 'noreply@example.test';

    await expect(
      send('applicant@example.com', 'verify', 'ar', { name: 'Test', link: 'https://example.test/verify?token=abc123' })
    ).rejects.toThrow('SES should never be reached in this test file');

    expect(sesSendMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT capture when NODE_ENV is neither test nor ci, even with the flag set', async () => {
    process.env.NODE_ENV = 'staging';
    process.env.E2E_CAPTURE_EMAIL = '1';
    process.env.AWS_REGION = 'us-east-1';
    process.env.SES_FROM_EMAIL = 'noreply@example.test';

    await expect(
      send('applicant@example.com', 'verify', 'ar', { name: 'Test', link: 'https://example.test/verify?token=abc123' })
    ).rejects.toThrow('SES should never be reached in this test file');

    expect(sesSendMock).toHaveBeenCalledTimes(1);
  });

  it('captures under NODE_ENV=ci as well as NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'ci';
    process.env.E2E_CAPTURE_EMAIL = '1';

    await send('applicant@example.com', 'verify', 'en', { name: 'Test', link: 'https://example.test/verify?token=xyz789' });

    expect(sesSendMock).not.toHaveBeenCalled();
    const content = await readFile(CAPTURE_FILE, 'utf8');
    expect(content).toContain('xyz789');
  });
});
