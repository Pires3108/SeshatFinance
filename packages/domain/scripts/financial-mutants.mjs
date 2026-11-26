#!/usr/bin/env node
/**
 * Targeted mutation check for the Sprint 7 calculations (US-048, ADR-042)
 * and the Sprint 8 goals, reserves and budgets (US-053, ADR-043).
 *
 * Each mutant is a deliberate, named defect in a financial algorithm. The
 * check applies one mutant at a time to the Domain sources, runs the specs
 * that protect it and requires them to fail ("killed"). Any survivor fails
 * the run. Sources are always restored, even on interruption.
 *
 * Usage: node scripts/financial-mutants.mjs [--list] [mutant-id ...]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vitest = resolve(root, '../../node_modules/vitest/vitest.mjs');

/** @type {readonly {id: string; invariant: string; file: string; find: string; replace: string; specs: string[]}[]} */
export const mutants = [
  {
    file: 'src/money/money.ts',
    find: 'this.minorUnits - regularShare * BigInt(count - 1),',
    id: 'last-cent-dropped',
    invariant: 'INV-005 / RN-018: the last installment loses the residual cent',
    replace: 'regularShare,',
    specs: ['src/money', 'src/installments'],
  },
  {
    file: 'src/interest/rational.ts',
    find: 'remainder * 2n >= this.denominator ? quotient + 1n : quotient;',
    id: 'half-up-to-half-down',
    invariant: 'RII-007: ties rounded down instead of half up',
    replace: 'remainder * 2n > this.denominator ? quotient + 1n : quotient;',
    specs: ['src/interest', 'src/installments'],
  },
  {
    file: 'src/installments/installment-plan.ts',
    find: '  return principal.multiply(Rational.one.add(periodic).pow(count));',
    id: 'early-rounding',
    invariant: 'RII-007: compound total rounded after the first period',
    replace:
      '  return Rational.of(\n    principal.multiply(Rational.one.add(periodic)).roundHalfUp(),\n  ).multiply(Rational.one.add(periodic).pow(count - 1));',
    specs: ['src/installments'],
  },
  {
    file: 'src/installments/installment-plan.ts',
    find: '    return principal.add(\n      principal.multiply(periodic).multiply(Rational.of(BigInt(count))),',
    id: 'simple-interest-operator',
    invariant: 'RN-020: simple interest subtracted instead of added',
    replace:
      '    return principal.subtract(\n      principal.multiply(periodic).multiply(Rational.of(BigInt(count))),',
    specs: ['src/installments'],
  },
  {
    file: 'src/installments/installment-plan.ts',
    find: '  return principal.multiply(Rational.one.add(periodic).pow(count));',
    id: 'period-shifted',
    invariant: 'RN-020: one compounding period lost',
    replace:
      '  return principal.multiply(Rational.one.add(periodic).pow(count - 1));',
    specs: ['src/installments'],
  },
  {
    file: 'src/interest/interest-rate.ts',
    find: '      percent.divide(hundred),',
    id: 'rate-scale',
    invariant: 'US-045: percentage read with the wrong scale',
    replace: '      percent.divide(Rational.of(1000n)),',
    specs: ['src/interest', 'src/installments'],
  },
  {
    file: 'src/installments/installment-plan.ts',
    find: '        : (interestUnits * cumulativeAmount) / totalUnits;',
    id: 'interest-equal-split',
    invariant: 'INV-019: interest split evenly instead of by cumulative share',
    replace: '        : (interestUnits * BigInt(index + 1)) / BigInt(count);',
    specs: ['src/installments', 'src/cards'],
  },
  {
    file: 'src/loans/loan-schedule.ts',
    find: '(denominatorPowers[count - k] ?? 1n)',
    id: 'price-amortization-shifted',
    invariant: 'ADR-042: Price cumulative amortization shifted by one period',
    replace: '(denominatorPowers[count - k + 1] ?? 1n)',
    specs: ['src/loans'],
  },
  {
    file: 'src/loans/loan.ts',
    find: "  'fee',\n  'interest',\n  'principal',\n];",
    id: 'allocation-order-inverted',
    invariant: 'ADR-042: partial payment allocation priority inverted',
    replace: "  'principal',\n  'interest',\n  'fee',\n];",
    specs: ['src/loans'],
  },
  {
    file: 'src/loans/loan-ledger.ts',
    find: '      (item) => item.closedBy === null && item.dueOn.compare(on) <= 0,',
    id: 'future-installments-eligible',
    invariant: 'US-046/047: future installments treated as due obligation',
    replace: '      (item) => item.closedBy === null,',
    specs: ['src/loans'],
  },
  {
    file: 'src/loans/loan-ledger.ts',
    find: '      item.dueOn.compare(on) >= 0 ||',
    id: 'delay-on-due-date',
    invariant: 'RII-019: delay and fee start on the due date itself',
    replace: '      item.dueOn.compare(on) > 0 ||',
    specs: ['src/loans'],
  },
  {
    file: 'src/loans/loan-ledger.ts',
    find: 'amount + discount !== pending',
    id: 'loan-prepayment-discount-ignored',
    invariant: 'INV-048: prepayment discount ignored',
    replace: 'amount !== pending',
    specs: ['src/loans'],
  },
  {
    file: 'src/cards/card-installment-plan-change.ts',
    find: 'amount + discount !== owed',
    id: 'card-prepayment-discount-ignored',
    invariant: 'INV-017: card prepayment discount ignored',
    replace: 'amount !== owed',
    specs: ['src/cards'],
  },
  // Sprint 8 (US-053): reserves, contributions, progress and budgets.
  {
    file: 'src/reserves/account-reserve.ts',
    find: '    available: book.subtract(reserved),',
    id: 'reserve-creates-money',
    invariant: 'INV-012/INV-013: available ignores the reserve',
    replace: '    available: book,',
    specs: ['src/reserves', 'src/goals', 'src/budgets'],
  },
  {
    file: 'src/reserves/account-reserve.ts',
    find: '  if (amount.compare(balance) > 0)\n    throw new AccountReserveExceedsBalanceError();',
    id: 'reserve-above-balance-accepted',
    invariant: 'RN-071: a reserve above the balance is accepted',
    replace:
      '  if (amount.compare(balance) > 1)\n    throw new AccountReserveExceedsBalanceError();',
    specs: ['src/reserves', 'src/goals', 'src/budgets'],
  },
  {
    file: 'src/goals/goal-contribution.ts',
    find: '  if (total.compare(source) > 0) throw new ContributionExceedsSourceError();',
    id: 'contribution-exceeds-source',
    invariant: 'INV-025: lines may exceed their entry',
    replace:
      '  if (total.compare(source) > 1) throw new ContributionExceedsSourceError();',
    specs: ['src/reserves', 'src/goals', 'src/budgets'],
  },
  {
    file: 'src/goals/goal-progress.ts',
    find: "  const excluded = position.sourceLifecycle === 'trashed';",
    id: 'trashed-entry-counts',
    invariant: 'US-050: a trashed entry keeps counting',
    replace: '  const excluded = false;',
    specs: ['src/reserves', 'src/goals', 'src/budgets'],
  },
  {
    file: 'src/goals/goal-progress.ts',
    find: '  const coveredByAccount = linkedAccounts.has(position.accountId);',
    id: 'linked-entry-counted-twice',
    invariant: 'INV-025: an entry in a linked account counts twice',
    replace: '  const coveredByAccount = false;',
    specs: ['src/reserves', 'src/goals', 'src/budgets'],
  },
  {
    file: 'src/goals/goal-progress.ts',
    find: "    if (line.conversion.status === 'unavailable') accumulated = null;",
    id: 'missing-quote-counts-zero',
    invariant: 'INV-047: a missing quote counts as zero',
    replace: "    if (line.conversion.status === 'unavailable') continue;",
    specs: ['src/reserves', 'src/goals', 'src/budgets'],
  },
  {
    file: 'src/budgets/budget.ts',
    find: '      entry.notSpending ||\n',
    id: 'budget-transfer-counted',
    invariant: 'US-052: transfers and adjustments count as spending',
    replace: '',
    specs: ['src/reserves', 'src/goals', 'src/budgets'],
  },
  {
    file: 'src/budgets/budget.ts',
    find: '        ? realized.subtract(entry.amount)',
    id: 'budget-refund-ignored',
    invariant: 'US-052: linked refunds do not reduce realized',
    replace: '        ? realized',
    specs: ['src/reserves', 'src/goals', 'src/budgets'],
  },
  {
    file: 'src/budgets/budget.ts',
    find: '    if (next.effectiveFrom < input.currentMonth) {',
    id: 'budget-limit-retroactive',
    invariant: 'US-052: a limit change rewrites past months',
    replace: "    if (next.effectiveFrom < '0000-01') {",
    specs: ['src/reserves', 'src/goals', 'src/budgets'],
  },
];

function run(specs) {
  const result = spawnSync(
    process.execPath,
    [vitest, 'run', '--reporter=dot', ...specs],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' },
  );
  return result.status ?? 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const mutant of mutants) {
      console.log(`${mutant.id}\t${mutant.invariant}`);
    }
    return 0;
  }
  const selected =
    args.length === 0 ? mutants : mutants.filter((m) => args.includes(m.id));
  const originals = new Map();
  const restore = () => {
    for (const [path, content] of originals) writeFileSync(path, content);
  };
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });
  if (run([...new Set(selected.flatMap((m) => m.specs))]) !== 0) {
    console.error('Baseline specs fail; fix them before checking mutants.');
    return 1;
  }
  const survivors = [];
  try {
    for (const mutant of selected) {
      const path = resolve(root, mutant.file);
      const original = originals.get(path) ?? readFileSync(path, 'utf8');
      originals.set(path, original);
      // Checkouts may use CRLF; anchors are written with LF.
      const eol = original.includes('\r\n') ? '\r\n' : '\n';
      const find = mutant.find.replaceAll('\n', eol);
      const replace = mutant.replace.replaceAll('\n', eol);
      if (!original.includes(find)) {
        console.error(
          `Mutant ${mutant.id}: anchor not found in ${mutant.file}`,
        );
        survivors.push(mutant.id);
        continue;
      }
      writeFileSync(path, original.replace(find, replace));
      const killed = run(mutant.specs) !== 0;
      writeFileSync(path, original);
      console.log(
        `${killed ? 'killed  ' : 'SURVIVED'} ${mutant.id} — ${mutant.invariant}`,
      );
      if (!killed) survivors.push(mutant.id);
    }
  } finally {
    restore();
  }
  console.log(
    `${String(selected.length - survivors.length)}/${String(selected.length)} mutants killed.`,
  );
  return survivors.length === 0 ? 0 : 1;
}

process.exitCode = main();
