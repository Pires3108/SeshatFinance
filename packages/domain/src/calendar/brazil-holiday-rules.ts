/**
 * Versioned Brazilian holiday dataset used to shift card due dates (RII-015).
 *
 * Scope decided on 13/11/2026: national legal holidays, Carnival Monday and
 * Tuesday (bank calendar), state holidays by UF and municipal holidays of the
 * 27 state capitals. Every entry cites its source. Entries whose source could
 * not be confirmed are listed in `EXCLUDED_PENDING_REVIEW` and never applied.
 * Holders may declare missing municipal holidays for their own location.
 *
 * Sources: national laws as cited; state and capital entries from the 2026
 * survey of court calendars (sijur.com.br/feriados-forenses-2026, read on
 * 13/11/2026), which cites each law or court act. Bump the version on change.
 */
export const BRAZIL_HOLIDAY_DATASET_VERSION = '2026.11.13-1';

export type HolidayRule =
  | Readonly<{ kind: 'fixed'; month: number; day: number }>
  /** Days relative to Easter Sunday (Gregorian). */
  | Readonly<{ kind: 'easter'; offsetDays: number }>
  /** Fixed date moved to the following Sunday (SC, Lei 18.531/2022). */
  | Readonly<{ kind: 'fixed-moved-to-sunday'; month: number; day: number }>;

export type HolidayDefinition = Readonly<{
  name: string;
  rule: HolidayRule;
  source: string;
  /** First year the rule applies, when the source is recent. */
  validFrom?: number;
}>;

const fixed = (month: number, day: number): HolidayRule => ({
  day,
  kind: 'fixed',
  month,
});
const easter = (offsetDays: number): HolidayRule => ({
  kind: 'easter',
  offsetDays,
});

const GOOD_FRIDAY = easter(-2);
const CORPUS_CHRISTI = easter(60);

export const NATIONAL_HOLIDAYS: readonly HolidayDefinition[] = [
  {
    name: 'Confraternização Universal',
    rule: fixed(1, 1),
    source: 'Lei 662/1949',
  },
  {
    name: 'Carnaval (segunda-feira)',
    rule: easter(-48),
    source: 'Calendário bancário, Resolução CMN 4.880/2020',
  },
  {
    name: 'Carnaval (terça-feira)',
    rule: easter(-47),
    source: 'Calendário bancário, Resolução CMN 4.880/2020',
  },
  {
    name: 'Sexta-feira da Paixão',
    rule: GOOD_FRIDAY,
    source: 'Lei 9.093/1995; calendário bancário, Resolução CMN 4.880/2020',
  },
  { name: 'Tiradentes', rule: fixed(4, 21), source: 'Lei 662/1949' },
  { name: 'Dia do Trabalho', rule: fixed(5, 1), source: 'Lei 662/1949' },
  {
    name: 'Independência do Brasil',
    rule: fixed(9, 7),
    source: 'Lei 662/1949',
  },
  {
    name: 'Nossa Senhora Aparecida',
    rule: fixed(10, 12),
    source: 'Lei 6.802/1980',
  },
  { name: 'Finados', rule: fixed(11, 2), source: 'Lei 662/1949' },
  {
    name: 'Proclamação da República',
    rule: fixed(11, 15),
    source: 'Lei 662/1949',
  },
  {
    name: 'Dia Nacional de Zumbi e da Consciência Negra',
    rule: fixed(11, 20),
    source: 'Lei 14.759/2023',
    validFrom: 2024,
  },
  { name: 'Natal', rule: fixed(12, 25), source: 'Lei 662/1949' },
];

export const STATE_HOLIDAYS: Readonly<
  Record<string, readonly HolidayDefinition[]>
> = {
  AC: [
    {
      name: 'Dia do Evangélico',
      rule: fixed(1, 23),
      source: 'Lei estadual 1.538/2004',
    },
    {
      name: 'Dia Internacional da Mulher',
      rule: fixed(3, 8),
      source: 'Lei estadual 1.411/2001',
    },
    {
      name: 'Aniversário do Estado',
      rule: fixed(6, 15),
      source: 'Lei estadual 14/1964',
    },
    {
      name: 'Dia da Amazônia',
      rule: fixed(9, 5),
      source: 'Lei estadual 243/1968',
    },
  ],
  AL: [
    { name: 'São João', rule: fixed(6, 24), source: 'Lei estadual 5.508/1993' },
    {
      name: 'São Pedro',
      rule: fixed(6, 29),
      source: 'Lei estadual 5.509/1993',
    },
    {
      name: 'Emancipação Política',
      rule: fixed(9, 16),
      source: 'Decreto estadual 106.093/2025',
    },
  ],
  AM: [
    {
      name: 'Elevação do Amazonas a Província',
      rule: fixed(9, 5),
      source: 'Lei estadual 25/1977',
    },
  ],
  AP: [
    { name: 'São José', rule: fixed(3, 19), source: 'Lei estadual 667/2002' },
    {
      name: 'Dia de Cabralzinho',
      rule: fixed(5, 15),
      source: 'Lei estadual 2.213/2017',
      validFrom: 2017,
    },
    {
      name: 'Criação do ex-Território',
      rule: fixed(9, 13),
      source: 'Constituição do Estado do Amapá, art. 355',
    },
  ],
  BA: [
    {
      name: 'Independência da Bahia',
      rule: fixed(7, 2),
      source: 'Constituição do Estado da Bahia, art. 6º, § 3º',
    },
  ],
  CE: [
    {
      name: 'Data Magna do Ceará',
      rule: fixed(3, 25),
      source: 'Emenda Constitucional estadual 73/2011',
    },
  ],
  DF: [
    {
      name: 'Dia do Evangélico',
      rule: fixed(11, 30),
      source: 'Lei Distrital 963/1995',
    },
  ],
  ES: [
    {
      name: 'Nossa Senhora da Penha',
      rule: easter(8),
      source: 'Lei estadual 11.010/2019',
      validFrom: 2019,
    },
  ],
  GO: [],
  MA: [
    {
      name: 'Adesão do Maranhão à Independência',
      rule: fixed(7, 28),
      source: 'Lei estadual 2.457/1964',
    },
  ],
  MG: [],
  MS: [
    {
      name: 'Criação do Estado',
      rule: fixed(10, 11),
      source: 'Decreto "E" 46/2025',
    },
  ],
  MT: [],
  PA: [
    {
      name: 'Adesão do Grão-Pará à Independência',
      rule: fixed(8, 15),
      source: 'Lei estadual 5.999/1996',
    },
  ],
  PB: [
    {
      name: 'Fundação do Estado',
      rule: fixed(8, 5),
      source: 'Lei estadual 10.601/2015',
      validFrom: 2015,
    },
  ],
  PE: [
    {
      name: 'Data Magna (Revolução de 1817)',
      rule: fixed(3, 6),
      source: 'Leis estaduais 16.059/2017 e 16.241/2017',
      validFrom: 2017,
    },
  ],
  PI: [
    {
      name: 'Dia do Piauí',
      rule: fixed(10, 19),
      source: 'Lei estadual 176/1937',
    },
  ],
  PR: [],
  RJ: [
    {
      name: 'Dia de São Jorge',
      rule: fixed(4, 23),
      source: 'Lei estadual 5.198/2008',
    },
  ],
  RN: [
    {
      name: 'Mártires de Cunhaú e Uruaçu',
      rule: fixed(10, 3),
      source: 'Lei estadual 8.913/2006',
    },
  ],
  RO: [
    {
      name: 'Criação do Estado',
      rule: fixed(1, 4),
      source: 'Lei estadual 2.291/2010',
    },
  ],
  RR: [
    {
      name: 'Data Magna',
      rule: fixed(10, 5),
      source: 'Constituição do Estado de Roraima, art. 9º',
    },
  ],
  RS: [
    {
      name: 'Revolução Farroupilha',
      rule: fixed(9, 20),
      source: 'Constituição do Estado do RS, art. 6º, parágrafo único',
    },
  ],
  SC: [
    {
      name: 'Dia do Estado',
      rule: { day: 11, kind: 'fixed-moved-to-sunday', month: 8 },
      source: 'Lei estadual 18.531/2022',
      validFrom: 2023,
    },
    {
      name: 'Santa Catarina de Alexandria',
      rule: { day: 25, kind: 'fixed-moved-to-sunday', month: 11 },
      source: 'Lei estadual 18.531/2022',
      validFrom: 2023,
    },
  ],
  SE: [
    {
      name: 'Emancipação Política de Sergipe',
      rule: fixed(7, 8),
      source: 'Decreto estadual 1.333/2025',
    },
  ],
  SP: [
    {
      name: 'Revolução Constitucionalista',
      rule: fixed(7, 9),
      source: 'Lei estadual 9.497/1997',
    },
  ],
  TO: [
    {
      name: 'Senhor do Bonfim',
      rule: fixed(8, 15),
      source: 'Lei estadual 4.509/2024',
      validFrom: 2024,
    },
    {
      name: 'Nossa Senhora da Natividade',
      rule: fixed(9, 8),
      source: 'Lei estadual 627/1993',
    },
    {
      name: 'Criação do Estado',
      rule: fixed(10, 5),
      source: 'Lei estadual 98/1989',
    },
  ],
};

/** Capital holidays keyed by IBGE municipality code. */
export const CAPITAL_HOLIDAYS: Readonly<
  Record<
    string,
    Readonly<{
      name: string;
      stateCode: string;
      holidays: readonly HolidayDefinition[];
    }>
  >
> = {
  '1100205': {
    name: 'Porto Velho',
    stateCode: 'RO',
    holidays: [
      {
        name: 'Instalação do Município',
        rule: fixed(1, 24),
        source: 'Lei Municipal 190/1980; Ato TJRO 2.579/2025',
      },
      {
        name: 'Nossa Senhora Auxiliadora',
        rule: fixed(5, 24),
        source: 'Lei Municipal 190/1980; Ato TJRO 2.579/2025',
      },
      {
        name: 'Criação do Município',
        rule: fixed(10, 2),
        source: 'Lei Municipal 190/1980; Ato TJRO 2.579/2025',
      },
    ],
  },
  '1200401': {
    name: 'Rio Branco',
    stateCode: 'AC',
    holidays: [
      {
        name: 'Aniversário de Rio Branco',
        rule: fixed(12, 28),
        source: 'Lei Municipal 330/1981; Portaria PRESI TJAC 6.569/2025',
      },
    ],
  },
  '1302603': {
    name: 'Manaus',
    stateCode: 'AM',
    holidays: [
      {
        name: 'Aniversário de Manaus',
        rule: fixed(10, 24),
        source: 'Portaria TJAM 4.704/2025',
      },
    ],
  },
  '1400100': {
    name: 'Boa Vista',
    stateCode: 'RR',
    holidays: [
      {
        name: 'São Sebastião',
        rule: fixed(1, 20),
        source: 'Portaria TJRR/PR 1.558/2025',
      },
      {
        name: 'São Pedro',
        rule: fixed(6, 29),
        source: 'Portaria TJRR/PR 1.558/2025',
      },
      {
        name: 'Aniversário de Boa Vista',
        rule: fixed(7, 9),
        source: 'Portaria TJRR/PR 1.558/2025',
      },
    ],
  },
  '1501402': {
    name: 'Belém',
    stateCode: 'PA',
    holidays: [
      {
        name: 'Corpus Christi',
        rule: CORPUS_CHRISTI,
        source: 'Lei Municipal 6.306/1967; Portaria TJPA 4.765/2025-GP',
      },
    ],
  },
  '1600303': {
    name: 'Macapá',
    stateCode: 'AP',
    holidays: [
      {
        name: 'Aniversário de Macapá',
        rule: fixed(2, 4),
        source: 'Calendário forense TJAP 2026',
      },
    ],
  },
  '1721000': {
    name: 'Palmas',
    stateCode: 'TO',
    holidays: [
      {
        name: 'Padroeiro de Palmas',
        rule: fixed(3, 19),
        source: 'Portaria TJTO 3.741/2025, art. 4º',
      },
      {
        name: 'Aniversário de Palmas',
        rule: fixed(5, 20),
        source: 'Portaria TJTO 3.741/2025, art. 4º',
      },
    ],
  },
  '2111300': {
    name: 'São Luís',
    stateCode: 'MA',
    holidays: [
      {
        name: 'São Pedro',
        rule: fixed(6, 29),
        source: 'Resolução-GP TJMA 131/2025',
      },
      {
        name: 'Fundação de São Luís',
        rule: fixed(9, 8),
        source: 'Resolução-GP TJMA 131/2025',
      },
    ],
  },
  '2211001': {
    name: 'Teresina',
    stateCode: 'PI',
    holidays: [
      {
        name: 'Aniversário de Teresina',
        rule: fixed(8, 16),
        source: 'Lei Municipal 2.275/1994',
      },
      {
        name: 'Nossa Senhora da Conceição',
        rule: fixed(12, 8),
        source: 'Lei Municipal 2.275/1994',
      },
    ],
  },
  '2304400': { name: 'Fortaleza', stateCode: 'CE', holidays: [] },
  '2408102': {
    name: 'Natal',
    stateCode: 'RN',
    holidays: [
      {
        name: 'Santos Reis',
        rule: fixed(1, 6),
        source: 'Decreto Municipal 13.643/2025',
      },
      {
        name: 'Paixão de Cristo',
        rule: GOOD_FRIDAY,
        source: 'Decreto Municipal 13.643/2025',
      },
      {
        name: 'Corpus Christi',
        rule: CORPUS_CHRISTI,
        source: 'Decreto Municipal 13.643/2025',
      },
      {
        name: 'Nossa Senhora da Apresentação',
        rule: fixed(11, 21),
        source: 'Decreto Municipal 13.643/2025',
      },
    ],
  },
  '2507507': { name: 'João Pessoa', stateCode: 'PB', holidays: [] },
  '2611606': {
    name: 'Recife',
    stateCode: 'PE',
    holidays: [
      {
        name: 'Nossa Senhora do Carmo',
        rule: fixed(7, 16),
        source: 'Ato Conjunto TJPE 43/2025, art. 2º',
      },
    ],
  },
  '2704302': {
    name: 'Maceió',
    stateCode: 'AL',
    holidays: [
      {
        name: 'Corpus Christi',
        rule: CORPUS_CHRISTI,
        source: 'Lei Municipal 1.391/1967; Decreto Municipal 10.234/2025',
      },
      {
        name: 'Marechal Floriano Peixoto',
        rule: fixed(6, 29),
        source: 'Lei Municipal 1.391/1967; Decreto Municipal 10.234/2025',
      },
      {
        name: 'Nossa Senhora dos Prazeres',
        rule: fixed(8, 27),
        source: 'Lei Municipal 1.391/1967; Decreto Municipal 10.234/2025',
      },
      {
        name: 'Nossa Senhora da Conceição',
        rule: fixed(12, 8),
        source: 'Lei Municipal 1.391/1967; Decreto Municipal 10.234/2025',
      },
    ],
  },
  '2800308': {
    name: 'Aracaju',
    stateCode: 'SE',
    holidays: [
      {
        name: 'Aniversário de Aracaju',
        rule: fixed(3, 17),
        source: 'Calendário TJSE 2026',
      },
      {
        name: 'Nossa Senhora da Conceição',
        rule: fixed(12, 8),
        source: 'Calendário TJSE 2026',
      },
    ],
  },
  '2927408': {
    name: 'Salvador',
    stateCode: 'BA',
    holidays: [
      {
        name: 'Corpus Christi',
        rule: CORPUS_CHRISTI,
        source: 'Decreto Judiciário TJBA 1.050/2025, art. 5º, VI',
      },
      {
        name: 'São João',
        rule: fixed(6, 24),
        source: 'Decreto Judiciário TJBA 1.050/2025, art. 5º, VII',
      },
      {
        name: 'Nossa Senhora da Conceição da Praia',
        rule: fixed(12, 8),
        source: 'Decreto Judiciário TJBA 1.050/2025, art. 5º, XV',
      },
    ],
  },
  '3106200': {
    name: 'Belo Horizonte',
    stateCode: 'MG',
    holidays: [
      {
        name: 'Corpus Christi',
        rule: CORPUS_CHRISTI,
        source: 'TJMG, feriados locais da comarca de Belo Horizonte',
      },
      {
        name: 'Assunção de Nossa Senhora',
        rule: fixed(8, 15),
        source: 'TJMG, feriados locais da comarca de Belo Horizonte',
      },
      {
        name: 'Nossa Senhora da Conceição',
        rule: fixed(12, 8),
        source: 'TJMG, feriados locais da comarca de Belo Horizonte',
      },
    ],
  },
  '3205309': {
    name: 'Vitória',
    stateCode: 'ES',
    holidays: [
      {
        name: 'Colonização do Solo Espírito-Santense',
        rule: fixed(5, 23),
        source: 'Tabela de feriados municipais do TJES',
      },
      {
        name: 'Nossa Senhora da Vitória',
        rule: fixed(9, 8),
        source: 'Tabela de feriados municipais do TJES',
      },
    ],
  },
  '3304557': {
    name: 'Rio de Janeiro',
    stateCode: 'RJ',
    holidays: [
      {
        name: 'São Sebastião',
        rule: fixed(1, 20),
        source: 'Lei Orgânica do Município do Rio de Janeiro, art. 26',
      },
    ],
  },
  '3550308': {
    name: 'São Paulo',
    stateCode: 'SP',
    holidays: [
      {
        name: 'Fundação da cidade',
        rule: fixed(1, 25),
        source: 'Tabela de feriados do TJSP',
      },
    ],
  },
  '4106902': {
    name: 'Curitiba',
    stateCode: 'PR',
    holidays: [
      {
        name: 'Padroeira de Curitiba',
        rule: fixed(9, 8),
        source: 'Decreto Judiciário TJPR 621/2025, art. 1º',
      },
    ],
  },
  '4205407': {
    name: 'Florianópolis',
    stateCode: 'SC',
    holidays: [
      {
        name: 'Aniversário de Florianópolis',
        rule: fixed(3, 23),
        source: 'Resolução GP TJSC 1/2026',
      },
    ],
  },
  '4314902': {
    name: 'Porto Alegre',
    stateCode: 'RS',
    holidays: [
      {
        name: 'Nossa Senhora dos Navegantes',
        rule: fixed(2, 2),
        source: 'Ato 05/2025-OE do TJRS',
      },
      {
        name: 'Corpus Christi',
        rule: CORPUS_CHRISTI,
        source: 'Ato 05/2025-OE do TJRS',
      },
    ],
  },
  '5002704': {
    name: 'Campo Grande',
    stateCode: 'MS',
    holidays: [
      {
        name: 'Aniversário de Campo Grande',
        rule: fixed(8, 26),
        source: 'Portaria TJMS 983/2025',
      },
    ],
  },
  '5103403': {
    name: 'Cuiabá',
    stateCode: 'MT',
    holidays: [
      {
        name: 'Aniversário de Cuiabá',
        rule: fixed(4, 8),
        source: 'Portaria TJMT/PRES 1.915/2025',
      },
      {
        name: 'Imaculada Conceição',
        rule: fixed(12, 8),
        source: 'Portaria TJMT/PRES 1.915/2025',
      },
    ],
  },
  '5208707': {
    name: 'Goiânia',
    stateCode: 'GO',
    holidays: [
      {
        name: 'Nossa Senhora Auxiliadora',
        rule: fixed(5, 24),
        source: 'Calendário TJGO 2026',
      },
      {
        name: 'Aniversário de Goiânia',
        rule: fixed(10, 24),
        source: 'Calendário TJGO 2026',
      },
    ],
  },
  '5300108': { name: 'Brasília', stateCode: 'DF', holidays: [] },
};

/** Not applied: the cited survey could not confirm the source or the rule. */
export const EXCLUDED_PENDING_REVIEW: readonly string[] = [
  'AL 30/11 Dia do Evangélico: sem base legal confirmada',
  'PE 24/06 São João: sem lei estadual citada',
  'AC Dia do Católico (20/01) e Tratado de Petrópolis (17/11): regra de transferência da Lei estadual 2.126/2009 não determinada',
];
