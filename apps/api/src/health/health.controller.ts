import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { DatabaseReadiness } from './database-readiness.js';

export type HealthResponse = Readonly<{
  service: 'api';
  status: 'ok';
}>;

@Controller('health')
@ApiTags('health')
export class HealthController {
  public constructor(
    @Inject(DatabaseReadiness) private readonly database: DatabaseReadiness,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check API liveness' })
  @ApiOkResponse({
    schema: {
      example: { service: 'api', status: 'ok' },
      properties: {
        service: { type: 'string', enum: ['api'] },
        status: { type: 'string', enum: ['ok'] },
      },
      required: ['service', 'status'],
      type: 'object',
    },
  })
  public getHealth(): HealthResponse {
    return { service: 'api', status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check API persistence readiness' })
  @ApiOkResponse({
    schema: {
      example: { service: 'api', status: 'ok' },
      properties: {
        service: { type: 'string', enum: ['api'] },
        status: { type: 'string', enum: ['ok'] },
      },
      required: ['service', 'status'],
      type: 'object',
    },
  })
  @ApiServiceUnavailableResponse({ description: 'Persistence is unavailable' })
  public async getReadiness(): Promise<HealthResponse> {
    if (!(await this.database.isReady())) {
      throw new ServiceUnavailableException();
    }
    return { service: 'api', status: 'ok' };
  }
}
