import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../src/lib/api-error.js';
import { developmentLoopbackOnly } from '../src/middleware/development-loopback-only.js';

test('development guard allows IPv4, IPv6 and mapped loopback TCP peers', () => {
  for (const address of ['127.0.0.1', '127.10.20.30', '::1', '::ffff:127.0.0.1']) {
    let called = false;
    developmentLoopbackOnly('development')(
      { socket: { remoteAddress: address } } as Request, {} as Response,
      ((error?: unknown) => { assert.equal(error, undefined); called = true; }) as NextFunction,
    );
    assert.ok(called);
  }
});

test('development guard rejects remote/missing peers even if Express proxy trust and headers claim loopback', () => {
  for (const address of ['192.168.1.2', '10.0.0.1', '203.0.113.1', '::ffff:192.168.1.2', '::', undefined]) {
    let called = false;
    developmentLoopbackOnly('development')(
      { socket: { remoteAddress: address }, ip: '127.0.0.1', headers: { 'x-forwarded-for': '127.0.0.1', 'x-role': 'ADMIN' } } as unknown as Request,
      {} as Response,
      ((error: unknown) => { assert.ok(error instanceof ApiError); assert.equal(error.status, 403); called = true; }) as NextFunction,
    );
    assert.ok(called);
  }
});
