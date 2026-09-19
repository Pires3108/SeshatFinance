import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined) {
  throw new Error('DATABASE_URL is required to run the synthetic seed.');
}

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
