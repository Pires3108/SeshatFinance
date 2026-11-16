import { Currency, Money } from '@seshat/domain';

import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

type QueryClient = PrismaClient | Prisma.TransactionClient;

export type CycleChargeSum = Readonly<{ count: number; total: Money }>;

/**
 * Charges that compose each invoice cycle (INV-017, ADR-042): purchases paid
 * in a single invoice plus the installment of each plan in that cycle. A
 * purchase with an installment plan no longer counts in its own cycle; a
 * non-reversed prepayment or renegotiation removes the later installments of
 * its plan, and a prepayment adds its declared amount to its own cycle.
 */
export async function cycleChargeSums(
  client: QueryClient,
  cardId: string,
  ownerId: string,
  closesOn?: Date,
): Promise<ReadonlyMap<string, CycleChargeSum>> {
  const cycleFilter =
    closesOn === undefined
      ? Prisma.empty
      : Prisma.sql`AND charges."cycle_closes_on" = ${closesOn}::date`;
  const rows = await client.$queryRaw<
    {
      cycle_closes_on: Date;
      currency_code: string;
      currency_minor_unit_scale: number;
      total: string;
      count: bigint;
    }[]
  >`
    SELECT charges."cycle_closes_on",
           charges."currency_code",
           charges."currency_minor_unit_scale",
           SUM(charges."amount_minor_units")::text AS "total",
           COUNT(*) AS "count"
    FROM (
      SELECT p."cycle_closes_on", p."currency_code",
             p."currency_minor_unit_scale", p."amount_minor_units"
      FROM "card_purchases" p
      WHERE p."owner_id" = ${ownerId}::uuid
        AND p."card_id" = ${cardId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM "card_installment_plans" plan
          WHERE plan."purchase_id" = p."id" AND plan."owner_id" = p."owner_id"
        )
      UNION ALL
      SELECT i."cycle_closes_on", i."currency_code",
             i."currency_minor_unit_scale", i."amount_minor_units"
      FROM "card_installments" i
      WHERE i."owner_id" = ${ownerId}::uuid
        AND i."card_id" = ${cardId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM "card_installment_plan_changes" c
          WHERE c."plan_id" = i."plan_id"
            AND c."owner_id" = i."owner_id"
            AND c."kind" IN ('prepayment', 'renegotiation')
            AND c."effective_cycle_closes_on" < i."cycle_closes_on"
            AND NOT EXISTS (
              SELECT 1 FROM "card_installment_plan_changes" r
              WHERE r."kind" = 'reversal' AND r."reversed_change_id" = c."id"
            )
        )
      UNION ALL
      SELECT c."effective_cycle_closes_on", plan."currency_code",
             plan."currency_minor_unit_scale", c."amount_minor_units"
      FROM "card_installment_plan_changes" c
      JOIN "card_installment_plans" plan
        ON plan."id" = c."plan_id" AND plan."owner_id" = c."owner_id"
      WHERE c."owner_id" = ${ownerId}::uuid
        AND plan."card_id" = ${cardId}::uuid
        AND c."kind" = 'prepayment'
        AND NOT EXISTS (
          SELECT 1 FROM "card_installment_plan_changes" r
          WHERE r."kind" = 'reversal' AND r."reversed_change_id" = c."id"
        )
    ) AS charges
    WHERE TRUE ${cycleFilter}
    GROUP BY 1, 2, 3
  `;
  return new Map(
    rows.map((row) => [
      row.cycle_closes_on.toISOString().slice(0, 10),
      {
        count: Number(row.count),
        total: Money.fromMinorUnits(
          BigInt(row.total),
          Currency.create(row.currency_code, row.currency_minor_unit_scale),
        ),
      },
    ]),
  );
}
