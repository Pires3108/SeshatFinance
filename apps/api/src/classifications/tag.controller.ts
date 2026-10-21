import {
  CreateTagUseCase,
  DeleteOwnedTagUseCase,
  DuplicateTagError,
  GetOwnedTagUseCase,
  ListOwnedTagsUseCase,
  OwnedTagNotFoundError,
  RenameOwnedTagUseCase,
  SetOwnedTagArchivedUseCase,
  TagLinkedError,
  TagVersionConflictError,
} from '@seshat/application';
import { InvalidTagError, type Tag } from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
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

const tagIdSchema = z.uuid();
const createTagSchema = z.object({ name: z.string().trim().min(1) });
const renameTagSchema = z.object({ name: z.string().trim().min(1) });

type CreateTagRequest = z.infer<typeof createTagSchema>;
type RenameTagRequest = z.infer<typeof renameTagSchema>;
type TagResponse = Readonly<{
  archivedAt: string | null;
  createdAt: string;
  id: string;
  name: string;
  updatedAt: string;
  version: number;
}>;

const tagResponseSchema: SchemaObject = {
  properties: {
    archivedAt: { format: 'date-time', nullable: true, type: 'string' },
    createdAt: { format: 'date-time', type: 'string' },
    id: { format: 'uuid', type: 'string' },
    name: { minLength: 1, type: 'string' },
    updatedAt: { format: 'date-time', type: 'string' },
    version: { minimum: 1, type: 'integer' },
  },
  required: ['archivedAt', 'createdAt', 'id', 'name', 'updatedAt', 'version'],
  type: 'object',
};

@Controller('tags')
@ApiTags('tags')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class TagController {
  public constructor(
    @Inject(CreateTagUseCase)
    private readonly createTag: CreateTagUseCase,
    @Inject(ListOwnedTagsUseCase)
    private readonly listTags: ListOwnedTagsUseCase,
    @Inject(RenameOwnedTagUseCase)
    private readonly renameTag: RenameOwnedTagUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
    @Optional()
    @Inject(GetOwnedTagUseCase)
    private readonly getTag?: GetOwnedTagUseCase,
    @Optional()
    @Inject(SetOwnedTagArchivedUseCase)
    private readonly setArchived?: SetOwnedTagArchivedUseCase,
    @Optional()
    @Inject(DeleteOwnedTagUseCase)
    private readonly deleteTag?: DeleteOwnedTagUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a tag owned by the authenticated user' })
  @ApiBody({ schema: tagBodySchema() })
  @ApiCreatedResponse({ schema: tagResponseSchema })
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(createTagSchema)) body: CreateTagRequest,
  ): Promise<TagResponse> {
    try {
      return mapTag(
        await this.createTag.execute({
          actorId: this.actorId(request),
          name: body.name,
        }),
      );
    } catch (error) {
      throw mapTagError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'List tags owned by the authenticated user' })
  @ApiOkResponse({ schema: { items: tagResponseSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<readonly TagResponse[]> {
    const tags = await this.listTags.execute(this.actorId(request));
    return tags.map(mapTag);
  }

  @Get(':tagId')
  @ApiOperation({ summary: 'Get an owned tag' })
  @ApiParam({ format: 'uuid', name: 'tagId', type: 'string' })
  @ApiOkResponse({ schema: tagResponseSchema })
  @ApiNotFoundResponse({ description: 'Owned tag was not found' })
  public async get(
    @Req() request: FastifyRequest,
    @Param('tagId', new ZodValidationPipe(tagIdSchema)) tagId: string,
  ): Promise<TagResponse> {
    try {
      return mapTag(
        await requireUseCase(this.getTag).execute({
          actorId: this.actorId(request),
          tagId,
        }),
      );
    } catch (error) {
      throw mapTagError(error);
    }
  }

  @Patch(':tagId')
  @ApiOperation({ summary: 'Rename an owned tag' })
  @ApiParam({ format: 'uuid', name: 'tagId', type: 'string' })
  @ApiBody({ schema: tagBodySchema() })
  @ApiOkResponse({ schema: tagResponseSchema })
  @ApiNotFoundResponse({ description: 'Owned tag was not found' })
  public async rename(
    @Req() request: FastifyRequest,
    @Param('tagId', new ZodValidationPipe(tagIdSchema)) tagId: string,
    @Body(new ZodValidationPipe(renameTagSchema)) body: RenameTagRequest,
  ): Promise<TagResponse> {
    try {
      return mapTag(
        await this.renameTag.execute({
          actorId: this.actorId(request),
          name: body.name,
          tagId,
        }),
      );
    } catch (error) {
      throw mapTagError(error);
    }
  }

  @Patch(':tagId/archive')
  @ApiOperation({ summary: 'Archive an owned tag' })
  @ApiParam({ format: 'uuid', name: 'tagId', type: 'string' })
  @ApiOkResponse({ schema: tagResponseSchema })
  public async archive(
    @Req() request: FastifyRequest,
    @Param('tagId', new ZodValidationPipe(tagIdSchema)) tagId: string,
  ): Promise<TagResponse> {
    try {
      return mapTag(
        await requireUseCase(this.setArchived).execute({
          actorId: this.actorId(request),
          tagId,
          archived: true,
        }),
      );
    } catch (error) {
      throw mapTagError(error);
    }
  }

  @Patch(':tagId/restore')
  @ApiOperation({ summary: 'Restore an owned tag' })
  @ApiParam({ format: 'uuid', name: 'tagId', type: 'string' })
  @ApiOkResponse({ schema: tagResponseSchema })
  public async restore(
    @Req() request: FastifyRequest,
    @Param('tagId', new ZodValidationPipe(tagIdSchema)) tagId: string,
  ): Promise<TagResponse> {
    try {
      return mapTag(
        await requireUseCase(this.setArchived).execute({
          actorId: this.actorId(request),
          tagId,
          archived: false,
        }),
      );
    } catch (error) {
      throw mapTagError(error);
    }
  }

  @Delete(':tagId')
  @ApiOperation({ summary: 'Delete an unlinked owned tag' })
  @ApiParam({ format: 'uuid', name: 'tagId', type: 'string' })
  public async remove(
    @Req() request: FastifyRequest,
    @Param('tagId', new ZodValidationPipe(tagIdSchema)) tagId: string,
  ): Promise<void> {
    try {
      await requireUseCase(this.deleteTag).execute({
        actorId: this.actorId(request),
        tagId,
      });
    } catch (error) {
      throw mapTagError(error);
    }
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapTag(tag: Tag): TagResponse {
  const snapshot = tag.toSnapshot();
  return {
    archivedAt: snapshot.archivedAt?.toISOString() ?? null,
    createdAt: snapshot.createdAt.toISOString(),
    id: snapshot.id,
    name: snapshot.name,
    updatedAt: snapshot.updatedAt.toISOString(),
    version: snapshot.version,
  };
}

function mapTagError(error: unknown): Error {
  if (error instanceof OwnedTagNotFoundError) {
    return new NotFoundException('Tag not found.');
  }
  if (error instanceof TagVersionConflictError) {
    return new ConflictException('Tag was modified concurrently.');
  }
  if (error instanceof DuplicateTagError || error instanceof TagLinkedError) {
    return new ConflictException(error.message);
  }
  if (error instanceof InvalidTagError) {
    return new BadRequestException('Invalid tag operation.');
  }
  return error instanceof Error ? error : new Error('Unknown tag error.');
}

function tagBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: { name: { minLength: 1, type: 'string' } },
    required: ['name'],
    type: 'object',
  };
}

function requireUseCase<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Tag use case is unavailable.');
  return value;
}
