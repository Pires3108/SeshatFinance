'use client';

import type { ReactNode } from 'react';

import { decimalInput, localToday } from './loan-presentation';

type Interest = 'none' | 'simple' | 'compound';
export interface TermsDraft {
  description: string;
  principal: string;
  contractedOn: string;
  firstDueOn: string;
  count: string;
  profile: 'constant' | 'decreasing';
  interest: Interest;
  percent: string;
  lateFeePercent: string;
  businessDay: boolean;
}

export const emptyTerms = (): TermsDraft => ({
  businessDay: true,
  contractedOn: localToday(),
  count: '1',
  description: '',
  firstDueOn: localToday(),
  interest: 'none',
  lateFeePercent: '',
  percent: '',
  principal: '',
  profile: 'constant',
});

const PERCENT = /^\d{1,3}(?:[.,]\d{1,6})?$/u;

/** Validates the draft and returns the API terms or a pt-BR message. */
export function termsPayload(
  draft: TermsDraft,
): Record<string, unknown> | string {
  const principal = decimalInput(draft.principal);
  const count = Number(draft.count);
  if (draft.description.trim() === '') return 'Informe uma descrição.';
  if (principal === null)
    return 'Informe o valor principal, por exemplo 1000,00.';
  if (!Number.isInteger(count) || count < 1 || count > 420)
    return 'Informe de 1 a 420 parcelas.';
  if (draft.firstDueOn < draft.contractedOn)
    return 'O primeiro vencimento não pode ser anterior à data do contrato.';
  if (draft.interest !== 'none' && !PERCENT.test(draft.percent.trim()))
    return 'Informe a taxa mensal em porcentagem, por exemplo 1,99.';
  if (
    draft.lateFeePercent.trim() !== '' &&
    !PERCENT.test(draft.lateFeePercent.trim())
  )
    return 'Informe a multa em porcentagem, por exemplo 2.';
  return {
    businessDayRule: draft.businessDay ? 'next-business-day' : 'none',
    contractedOn: draft.contractedOn,
    count,
    currencyCode: 'BRL',
    currencyMinorUnitScale: 2,
    description: draft.description.trim(),
    firstDueOn: draft.firstDueOn,
    lateFeePercent:
      draft.lateFeePercent.trim() === ''
        ? null
        : draft.lateFeePercent.trim().replace(',', '.'),
    principal,
    profile: draft.profile,
    rate:
      draft.interest === 'none'
        ? null
        : {
            method: draft.interest,
            percentPerPeriod: draft.percent.trim().replace(',', '.'),
            periodicity: 'monthly',
          },
  };
}

/** Shared fields of a loan contract (creation and renegotiation). */
export function TermsFields({
  draft,
  prefix,
  setDraft,
}: Readonly<{
  draft: TermsDraft;
  prefix: string;
  setDraft: (draft: TermsDraft) => void;
}>): ReactNode {
  const text = (
    key: 'description' | 'principal' | 'count' | 'percent' | 'lateFeePercent',
    label: string,
    inputMode?: 'decimal' | 'numeric',
  ): ReactNode => (
    <div className="field">
      <label htmlFor={`${prefix}-${key}`}>{label}</label>
      <input
        id={`${prefix}-${key}`}
        inputMode={inputMode}
        onChange={(event) => {
          setDraft({ ...draft, [key]: event.target.value });
        }}
        value={draft[key]}
      />
    </div>
  );
  const date = (
    key: 'contractedOn' | 'firstDueOn',
    label: string,
  ): ReactNode => (
    <div className="field">
      <label htmlFor={`${prefix}-${key}`}>{label}</label>
      <input
        id={`${prefix}-${key}`}
        onChange={(event) => {
          setDraft({ ...draft, [key]: event.target.value });
        }}
        type="date"
        value={draft[key]}
      />
    </div>
  );
  return (
    <>
      {text('description', 'Descrição')}
      {text('principal', 'Valor principal (BRL)', 'decimal')}
      {date('contractedOn', 'Data do contrato')}
      {date('firstDueOn', 'Primeiro vencimento')}
      {text('count', 'Número de parcelas', 'numeric')}
      <div className="field">
        <label htmlFor={`${prefix}-profile`}>Perfil das parcelas</label>
        <select
          id={`${prefix}-profile`}
          onChange={(event) => {
            setDraft({
              ...draft,
              profile: event.target.value as TermsDraft['profile'],
            });
          }}
          value={draft.profile}
        >
          <option value="constant">Constantes (Price)</option>
          <option value="decreasing">Decrescentes (SAC)</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-interest`}>Juros</label>
        <select
          id={`${prefix}-interest`}
          onChange={(event) => {
            setDraft({ ...draft, interest: event.target.value as Interest });
          }}
          value={draft.interest}
        >
          <option value="none">Sem juros</option>
          <option value="simple">Juros simples</option>
          <option value="compound">Juros compostos</option>
        </select>
      </div>
      {draft.interest !== 'none' &&
        text('percent', 'Taxa ao mês (%)', 'decimal')}
      {text('lateFeePercent', 'Multa por atraso (%) — opcional', 'decimal')}
      <div className="field">
        <label>
          <input
            checked={draft.businessDay}
            onChange={(event) => {
              setDraft({ ...draft, businessDay: event.target.checked });
            }}
            type="checkbox"
          />{' '}
          Vencimento em fim de semana ou feriado vai para o próximo dia útil
        </label>
      </div>
    </>
  );
}
