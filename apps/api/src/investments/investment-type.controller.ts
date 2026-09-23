import { ListInvestmentTypesUseCase } from '@seshat/application';
import { investmentTypeKeys, type InvestmentTypeKey } from '@seshat/domain';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';

type InvestmentTypeResponse = Readonly<{
  key: InvestmentTypeKey;
  label: string;
}>;

const labels: Readonly<Record<InvestmentTypeKey, string>> = {
  'treasury-direct': 'Tesouro Direto',
  cdb: 'CDB',
  lci: 'LCI',
  lca: 'LCA',
  savings: 'Poupança',
  stock: 'Ações',
  fii: 'FIIs',
  etf: 'ETFs',
  cryptocurrency: 'Criptomoedas',
  'investment-fund': 'Fundos',
  'private-pension': 'Previdência privada',
};

@Controller('investment-types')
@ApiTags('investments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class InvestmentTypeController {
  public constructor(
    @Inject(ListInvestmentTypesUseCase)
    private readonly listTypes: ListInvestmentTypesUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List supported manual investment types' })
  @ApiOkResponse({
    schema: {
      items: {
        properties: {
          key: { enum: [...investmentTypeKeys], type: 'string' },
          label: { type: 'string' },
        },
        required: ['key', 'label'],
        type: 'object',
      },
      type: 'array',
    },
  })
  public list(): readonly InvestmentTypeResponse[] {
    return this.listTypes.execute().map((type) => ({
      key: type.key,
      label: labels[type.key],
    }));
  }
}
