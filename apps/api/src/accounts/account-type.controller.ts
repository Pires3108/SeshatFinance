import { ListDefaultAccountTypesUseCase } from '@seshat/application';
import {
  defaultAccountTypeKeys,
  type DefaultAccountTypeKey,
} from '@seshat/domain';
import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';

type AccountTypeResponse = Readonly<{
  key: DefaultAccountTypeKey;
  label: string;
}>;

const labels: Readonly<Record<DefaultAccountTypeKey, string>> = {
  'checking-account': 'Conta corrente',
  'savings-account': 'Poupança',
  'cash-wallet': 'Carteira em dinheiro',
  reserve: 'Reserva',
  'credit-card': 'Cartão de crédito',
  'investment-account': 'Conta de investimento',
};

@Controller('account-types')
@ApiTags('accounts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class AccountTypeController {
  public constructor(
    @Inject(ListDefaultAccountTypesUseCase)
    private readonly listTypes: ListDefaultAccountTypesUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List default account types' })
  @ApiOkResponse({
    schema: {
      items: {
        properties: {
          key: { enum: [...defaultAccountTypeKeys], type: 'string' },
          label: { type: 'string' },
        },
        required: ['key', 'label'],
        type: 'object',
      },
      type: 'array',
    },
  })
  public list(): readonly AccountTypeResponse[] {
    return this.listTypes.execute().map((type) => ({
      key: type.key as DefaultAccountTypeKey,
      label: labels[type.key as DefaultAccountTypeKey],
    }));
  }
}
