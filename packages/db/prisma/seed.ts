/* Idempotent seed: categories always; the first SUPER_ADMIN only when
   SEED_ADMIN_EMAIL/PASSWORD are set and no super admin exists yet. */
import { PrismaClient } from '@prisma/client';
import { CATEGORY_SEED } from '@wcc/shared';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const c of CATEGORY_SEED) {
    // Never overwrite a rename by a SUPER_ADMIN: only create missing ones.
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: { slug: c.slug, name: c.name, sortOrder: c.sortOrder, allowsMultiDay: c.allowsMultiDay },
    });
  }
  console.log(`Categories: ${CATEGORY_SEED.length} ensured`);

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await prisma.user.count({ where: { role: 'SUPER_ADMIN' } });
  if (existing > 0) {
    console.log('A SUPER_ADMIN already exists; skipping admin seed');
    return;
  }
  if (password.length < 8) throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters');
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await prisma.user.create({
    data: {
      email,
      fullName: 'Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      passwordHash,
      passwordChangedAt: new Date(),
    },
  });
  console.log(`Created SUPER_ADMIN ${email} — sign in and enable 2FA.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
