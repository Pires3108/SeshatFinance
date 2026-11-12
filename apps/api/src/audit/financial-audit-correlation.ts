import { configureFinancialAuditCorrelation } from '@seshat/database';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import { CorrelationContext } from '../platform/correlation-context.js';

/** Records the request correlation id on every financial audit event. */
@Injectable()
export class FinancialAuditCorrelationBinding implements OnModuleInit {
  public constructor(
    @Inject(CorrelationContext)
    private readonly correlation: CorrelationContext,
  ) {}

  public onModuleInit(): void {
    configureFinancialAuditCorrelation(() =>
      this.correlation.getCorrelationId(),
    );
  }
}
