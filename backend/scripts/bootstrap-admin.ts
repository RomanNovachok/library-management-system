import 'dotenv/config';
import { createInterface as prompt } from 'node:readline/promises';
import { emitKeypressEvents, type Key } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { ApiError } from '../src/lib/api-error.js';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository.js';
import { newPassword, staffEmail } from '../src/modules/auth/auth.schemas.js';
import { StaffService } from '../src/modules/staff/staff.service.js';

async function hiddenPassword(label: string) {
  const previousMode = stdin.isRaw;
  stdout.write(label);
  stdin.setRawMode(true);
  emitKeypressEvents(stdin);
  let input = '';
  let onKey: (value: string | undefined, key: Key) => void = () => {};
  try {
    return await new Promise<string>((resolve, reject) => {
      onKey = (value, key) => {
        if (key.ctrl && (key.name === 'c' || key.name === 'd')) reject(new Error('Input cancelled'));
        else if (key.name === 'return' || key.name === 'enter') resolve(input);
        else if (key.name === 'backspace') input = Array.from(input).slice(0, -1).join('');
        else if (value && !key.ctrl && !key.meta && !/\p{Cc}/u.test(value)) input += value;
        if (input.length > 128) reject(new Error('Password too long'));
      };
      stdin.on('keypress', onKey);
      stdin.resume();
    });
  } finally {
    stdin.removeListener('keypress', onKey);
    stdin.setRawMode(previousMode);
    stdin.pause();
    stdout.write('\n');
  }
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('Interactive terminal required');
  const reader = prompt({ input: stdin, output: stdout });
  const email = staffEmail.safeParse(await reader.question('Email: ').finally(() => reader.close()));
  if (!email.success) {
    console.error('Enter a valid email address.');
    process.exitCode = 1;
    return;
  }
  const password = newPassword.safeParse(await hiddenPassword('Password: '));
  if (!password.success) {
    console.error('Use 12–128 characters, including a letter and a digit or symbol.');
    process.exitCode = 1;
    return;
  }
  if (password.data !== await hiddenPassword('Confirm password: ')) {
    console.error('Passwords do not match.');
    process.exitCode = 1;
    return;
  }
  const { prisma } = await import('../src/lib/prisma.js');
  try {
    await new StaffService(new PrismaAuthRepository()).bootstrap(email.data, password.data);
    console.info('Administrator created.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof ApiError ? error.message : 'Administrator setup failed. Check the interactive terminal, database connection and migrations.');
  process.exitCode = 1;
});
