import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller.js';
import { CorrelationContext } from './platform/correlation-context.js';
import { PrivacySafeLogger } from './platform/privacy-safe-logger.js';

@Module({
  controllers: [HealthController],
  providers: [CorrelationContext, PrivacySafeLogger],
})
export class AppModule {}
