import { ApiError } from '../../lib/api-error.js';

const windowMs = 15 * 60 * 1000;
const maxKeys = 10_000;

export class LoginLimit {
  private readonly counters = new Map<string, { expires: number; attempts: number }>();
  private nextSweep = 0;

  take(email: string, address: string | undefined, now: number) {
    if (now >= this.nextSweep) {
      for (const [key, counter] of this.counters) {
        if (counter.expires <= now) this.counters.delete(key);
      }
      this.nextSweep = now + 60_000;
    }

    const keys = [
      { key: 'all', limit: 300 },
      ...(address === undefined ? [] : [{ key: `ip:${address}`, limit: 40 }]),
      { key: `email:${email}`, limit: 8 },
    ];
    const counters = keys.map(({ key, limit }) => {
      const previous = this.counters.get(key);
      const counter = previous && previous.expires > now ? previous : { expires: now + windowMs, attempts: 0 };
      if (counter.attempts >= limit || (!previous && this.counters.size >= maxKeys)) {
        throw new ApiError(429, 'LOGIN_RATE_LIMITED', 'Too many login attempts. Try again later.');
      }
      return { key, counter };
    });
    for (const { key, counter } of counters) {
      counter.attempts++;
      this.counters.set(key, counter);
    }
  }
}
