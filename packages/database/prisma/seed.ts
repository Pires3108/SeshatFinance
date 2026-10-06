import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';
import { assertSyntheticSeedTarget } from '../src/prisma/synthetic-seed-policy.js';

const connectionString = assertSyntheticSeedTarget(
  process.env.DATABASE_URL,
  process.env.NODE_ENV,
);

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

try {
  await client.userProfile.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'Usuário de demonstração',
    },
  });
} finally {
  await client.$disconnect();
}
