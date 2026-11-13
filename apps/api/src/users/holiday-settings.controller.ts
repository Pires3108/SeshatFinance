import {
  DeclareHolidayUseCase,
  GetHolidaySettingsUseCase,
  InvalidDeclaredHolidayError,
  RemoveDeclaredHolidayUseCase,
  UpdateHolidayLocationUseCase,
  type DeclaredHolidayRecord,
  type HolidaySettings,
} from '@seshat/application';
import {
  BRAZIL_HOLIDAY_DATASET_VERSION,
  InvalidHolidayLocationError,
} from '@seshat/domain';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  type SchemaObject,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthenticatedActorContext } from '../auth/authenticated-actor-context.js';
import { BearerAuthGuard } from '../auth/bearer-auth.guard.js';
import { ZodValidationPipe } from '../platform/zod-validation.pipe.js';

const locationSchema = z.object({
  municipalityCode: z
    .string()
    .regex(/^\d{7}$/u)
    .nullable(),
  stateCode: z
    .string()
    .regex(/^[A-Z]{2}$/u)
    .nullable(),
});
const declaredSchema = z.object({
  day: z.number().int().min(1).max(31),
  month: z.number().int().min(1).max(12),
  name: z.string().trim().min(1).max(120),
  year: z.number().int().min(1900).max(9999).nullable(),
});
const holidayIdSchema = z.uuid();

type LocationRequest = z.infer<typeof locationSchema>;
type DeclaredRequest = z.infer<typeof declaredSchema>;
type DeclaredResponse = Readonly<{
  day: number;
  id: string;
  month: number;
  name: string;
  year: number | null;
}>;
type SettingsResponse = Readonly<{
  datasetVersion: string;
  declared: readonly DeclaredResponse[];
  municipalityCode: string | null;
  stateCode: string | null;
}>;

const nullableString = (pattern: string): SchemaObject => ({
  nullable: true,
  pattern,
  type: 'string',
});
const declaredProperties: Record<string, SchemaObject> = {
  day: { maximum: 31, minimum: 1, type: 'integer' },
  month: { maximum: 12, minimum: 1, type: 'integer' },
  name: { maxLength: 120, minLength: 1, type: 'string' },
  year: {
    description: 'null repeats every year.',
    maximum: 9999,
    minimum: 1900,
    nullable: true,
    type: 'integer',
  },
};
const declaredResponseSchema: SchemaObject = {
  properties: {
    ...declaredProperties,
    id: { format: 'uuid', type: 'string' },
  },
  required: ['day', 'id', 'month', 'name', 'year'],
  type: 'object',
};
const settingsResponseSchema: SchemaObject = {
  properties: {
    datasetVersion: { type: 'string' },
    declared: { items: declaredResponseSchema, type: 'array' },
    municipalityCode: nullableString('^\\d{7}$'),
    stateCode: nullableString('^[A-Z]{2}$'),
  },
  required: ['datasetVersion', 'declared', 'municipalityCode', 'stateCode'],
  type: 'object',
};

/** Location and declared holidays used to shift card due dates. */
@Controller('users/me/holiday-settings')
@ApiTags('users')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class HolidaySettingsController {
  public constructor(
    @Inject(GetHolidaySettingsUseCase)
    private readonly getSettings: GetHolidaySettingsUseCase,
    @Inject(UpdateHolidayLocationUseCase)
    private readonly updateLocation: UpdateHolidayLocationUseCase,
    @Inject(DeclareHolidayUseCase)
    private readonly declareHoliday: DeclareHolidayUseCase,
    @Inject(RemoveDeclaredHolidayUseCase)
    private readonly removeHoliday: RemoveDeclaredHolidayUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get the holiday location and declared holidays' })
  @ApiOkResponse({ schema: settingsResponseSchema })
  public async get(@Req() request: FastifyRequest): Promise<SettingsResponse> {
    return mapSettings(await this.getSettings.execute(this.actorId(request)));
  }

  @Put('location')
  @ApiOperation({
    summary: 'Set the UF and IBGE municipality used for holidays',
  })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: {
        municipalityCode: nullableString('^\\d{7}$'),
        stateCode: nullableString('^[A-Z]{2}$'),
      },
      required: ['municipalityCode', 'stateCode'],
      type: 'object',
    },
  })
  @ApiOkResponse({ schema: settingsResponseSchema })
  public async putLocation(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(locationSchema)) body: LocationRequest,
  ): Promise<SettingsResponse> {
    try {
      return mapSettings(
        await this.updateLocation.execute({
          actorId: this.actorId(request),
          ...body,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post('declared')
  @ApiOperation({ summary: 'Declare a local holiday missing from the dataset' })
  @ApiBody({
    schema: {
      additionalProperties: false,
      properties: declaredProperties,
      required: ['day', 'month', 'name', 'year'],
      type: 'object',
    },
  })
  @ApiCreatedResponse({ schema: declaredResponseSchema })
  public async declare(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(declaredSchema)) body: DeclaredRequest,
  ): Promise<DeclaredResponse> {
    try {
      return mapDeclared(
        await this.declareHoliday.execute({
          actorId: this.actorId(request),
          ...body,
        }),
      );
    } catch (error) {
      throw mapError(error);
    }
  }

  @Delete('declared/:holidayId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a declared holiday' })
  @ApiParam({ format: 'uuid', name: 'holidayId', type: 'string' })
  @ApiNoContentResponse({ description: 'Declared holiday removed' })
  @ApiNotFoundResponse({ description: 'Declared holiday was not found' })
  public async remove(
    @Req() request: FastifyRequest,
    @Param('holidayId', new ZodValidationPipe(holidayIdSchema))
    holidayId: string,
  ): Promise<void> {
    const removed = await this.removeHoliday.execute(
      holidayId,
      this.actorId(request),
    );
    if (!removed) throw new NotFoundException('Declared holiday not found.');
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapSettings(settings: HolidaySettings): SettingsResponse {
  return {
    datasetVersion: BRAZIL_HOLIDAY_DATASET_VERSION,
    declared: settings.declared.map(mapDeclared),
    municipalityCode: settings.location.municipalityCode,
    stateCode: settings.location.stateCode,
  };
}

function mapDeclared(holiday: DeclaredHolidayRecord): DeclaredResponse {
  return {
    day: holiday.day,
    id: holiday.id,
    month: holiday.month,
    name: holiday.name,
    year: holiday.year,
  };
}

function mapError(error: unknown): Error {
  if (
    error instanceof InvalidHolidayLocationError ||
    error instanceof InvalidDeclaredHolidayError
  ) {
    return new BadRequestException('Invalid holiday settings.');
  }
  return error instanceof Error
    ? error
    : new Error('Unknown holiday settings error.');
}
