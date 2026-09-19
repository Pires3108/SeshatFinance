import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

export type HealthResponse = Readonly<{
  service: 'api';
  status: 'ok';
}>;

@Controller('health')
@ApiTags('health')
export class HealthController {
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
}
