/**
 * Production admin bootstrap (§14.1): `pnpm --filter @wcc/api cli create-admin`
 * Prompts for email, name and password; creates an ACTIVE SUPER_ADMIN.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as argon2 from 'argon2';
import { PrismaClient } from '@wcc/db';

async function main(): Promise<void> {
  const [cmd] = process.argv.slice(2);
  if (cmd !== 'create-admin') {
    console.log('Usage: cli create-admin');
    process.exit(1);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  const email = (await rl.question('Email: ')).trim().toLowerCase();
  const fullName = (await rl.question('Full name: ')).trim();
  const password = await rl.question('Password (min 12 chars): ');
  rl.close();
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || fullName.length < 2 || password.length < 12) throw new Error('Invalid input');
  const prisma = new PrismaClient();
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await prisma.user.upsert({
      where: { email },
      update: { role: 'SUPER_ADMIN', status: 'ACTIVE', passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      create: { email, fullName, role: 'SUPER_ADMIN', status: 'ACTIVE', passwordHash, passwordChangedAt: new Date() },
    });
    console.log(`SUPER_ADMIN ${email} is ready. Sign in and set up 2FA.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
