import { Controller, Get } from '@nestjs/common';

export type HealthResponse = Readonly<{
  service: 'api';
  status: 'ok';
}>;

@Controller('health')
export class HealthController {
  @Get()
  public getHealth(): HealthResponse {
    return { service: 'api', status: 'ok' };
  }
}
