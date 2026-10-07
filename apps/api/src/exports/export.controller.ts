import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import {
  CreateExportJobUseCase,
  ExportJobExpiredError,
  ExportJobNotFoundError,
  ExportJobValidationError,
  GetExportDownloadUseCase,
  GetExportJobStatusUseCase,
  type ExportJob,
  type ExportSelection,
} from '@seshat/application';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const requestSchema = z.object({
  format: z.enum(['json', 'csv', 'xlsx']),
  idempotencyKey: z.string().min(8).max(128),
  selection: z.record(z.string(), z.unknown()),
});
const jobIdSchema = z.uuid();
type RequestBody = z.infer<typeof requestSchema>;

@ApiTags('exports')
@ApiBearerAuth()
@UseGuards(BearerAuthGuard)
@Controller('exports')
export class ExportController {
  public constructor(
    @Inject(CreateExportJobUseCase)
    private readonly createJob: CreateExportJobUseCase,
    @Inject(GetExportJobStatusUseCase)
    private readonly getStatus: GetExportJobStatusUseCase,
    @Inject(GetExportDownloadUseCase)
    private readonly getDownload: GetExportDownloadUseCase,
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post('jobs')
  @HttpCode(202)
  @ApiCreatedResponse({ description: 'Export job accepted for processing.' })
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(requestSchema)) body: RequestBody,
  ): Promise<ExportResponse> {
    const actor = this.actors.get(request);
    if (actor === undefined)
      throw new BadRequestException('Actor unavailable.');
    try {
      const job = await this.createJob.execute({
        actorId: actor.id,
        idempotencyKey: body.idempotencyKey,
        format: body.format,
        selection: body.selection as ExportSelection,
      });
      return toResponse(job);
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Get('jobs/:jobId')
  @ApiOkResponse({ description: 'Current export status.' })
  @ApiNotFoundResponse({ description: 'Export job not found.' })
  public async status(
    @Req() request: FastifyRequest,
    @Param('jobId') rawJobId: string,
  ): Promise<ExportResponse> {
    const actor = this.actors.get(request);
    if (actor === undefined)
      throw new BadRequestException('Actor unavailable.');
    const jobId = parseJobId(rawJobId);
    try {
      return toResponse(await this.getStatus.execute(actor.id, jobId));
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Post('jobs/:jobId/download')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Short lived private download URL.' })
  public async download(
    @Req() request: FastifyRequest,
    @Param('jobId') rawJobId: string,
  ): Promise<{ url: string }> {
    const actor = this.actors.get(request);
    if (actor === undefined)
      throw new BadRequestException('Actor unavailable.');
    const jobId = parseJobId(rawJobId);
    try {
      return { url: await this.getDownload.execute(actor.id, jobId) };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

type ExportResponse = Readonly<{
  id: string;
  format: string;
  status: string;
  progress: number;
  createdAt: string;
  expiresAt: string;
  downloadAvailable: boolean;
}>;

function toResponse(job: ExportJob): ExportResponse {
  return {
    id: job.id,
    format: job.format,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
    downloadAvailable: job.status === 'completed' && job.storageKey !== null,
  };
}

function parseJobId(value: string): string {
  const result = jobIdSchema.safeParse(value);
  if (!result.success)
    throw new BadRequestException('Export job id is invalid.');
  return result.data;
}

function toHttpError(error: unknown): Error {
  if (error instanceof ExportJobNotFoundError) return new NotFoundException();
  if (error instanceof ExportJobExpiredError)
    return new BadRequestException(error.message);
  if (error instanceof ExportJobValidationError)
    return new BadRequestException(error.message);
  return error instanceof Error ? error : new BadRequestException();
}
