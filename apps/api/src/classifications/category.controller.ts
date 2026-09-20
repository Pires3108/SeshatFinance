import {
  CategoryVersionConflictError,
  CreateCategoryUseCase,
  InvalidCategoryParentError,
  ListOwnedCategoriesUseCase,
  OwnedCategoryNotFoundError,
  RenameOwnedCategoryUseCase,
} from '@seshat/application';
import { InvalidCategoryError, type Category } from '@seshat/domain';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
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

const categoryIdSchema = z.uuid();
const createCategorySchema = z.object({
  name: z.string().trim().min(1),
  parentCategoryId: z.uuid().nullable(),
});
const renameCategorySchema = z.object({
  name: z.string().trim().min(1),
});

type CreateCategoryRequest = z.infer<typeof createCategorySchema>;
type RenameCategoryRequest = z.infer<typeof renameCategorySchema>;
type CategoryResponse = Readonly<{
  createdAt: string;
  id: string;
  name: string;
  parentCategoryId: string | null;
  updatedAt: string;
  version: number;
}>;

const categoryResponseSchema: SchemaObject = {
  properties: {
    createdAt: { format: 'date-time', type: 'string' },
    id: { format: 'uuid', type: 'string' },
    name: { minLength: 1, type: 'string' },
    parentCategoryId: { format: 'uuid', nullable: true, type: 'string' },
    updatedAt: { format: 'date-time', type: 'string' },
    version: { minimum: 1, type: 'integer' },
  },
  required: [
    'createdAt',
    'id',
    'name',
    'parentCategoryId',
    'updatedAt',
    'version',
  ],
  type: 'object',
};

@Controller('categories')
@ApiTags('categories')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Bearer token missing or invalid' })
@UseGuards(BearerAuthGuard)
export class CategoryController {
  public constructor(
    @Inject(CreateCategoryUseCase)
    private readonly createCategory: CreateCategoryUseCase,
    @Inject(ListOwnedCategoriesUseCase)
    private readonly listCategories: ListOwnedCategoriesUseCase,
    @Inject(RenameOwnedCategoryUseCase)
    private readonly renameCategory: RenameOwnedCategoryUseCase,
    @Inject(AuthenticatedActorContext)
    private readonly actors: AuthenticatedActorContext,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an owned category or subcategory' })
  @ApiBody({ schema: createCategoryBodySchema() })
  @ApiCreatedResponse({ schema: categoryResponseSchema })
  public async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(createCategorySchema))
    body: CreateCategoryRequest,
  ): Promise<CategoryResponse> {
    try {
      return mapCategory(
        await this.createCategory.execute({
          actorId: this.actorId(request),
          ...body,
        }),
      );
    } catch (error) {
      throw mapCategoryError(error);
    }
  }

  @Get()
  @ApiOperation({ summary: 'List categories owned by the authenticated user' })
  @ApiOkResponse({ schema: { items: categoryResponseSchema, type: 'array' } })
  public async list(
    @Req() request: FastifyRequest,
  ): Promise<readonly CategoryResponse[]> {
    const categories = await this.listCategories.execute(this.actorId(request));
    return categories.map(mapCategory);
  }

  @Patch(':categoryId')
  @ApiOperation({ summary: 'Rename an owned category' })
  @ApiParam({ format: 'uuid', name: 'categoryId', type: 'string' })
  @ApiBody({ schema: renameCategoryBodySchema() })
  @ApiOkResponse({ schema: categoryResponseSchema })
  @ApiNotFoundResponse({ description: 'Owned category was not found' })
  public async rename(
    @Req() request: FastifyRequest,
    @Param('categoryId', new ZodValidationPipe(categoryIdSchema))
    categoryId: string,
    @Body(new ZodValidationPipe(renameCategorySchema))
    body: RenameCategoryRequest,
  ): Promise<CategoryResponse> {
    try {
      return mapCategory(
        await this.renameCategory.execute({
          actorId: this.actorId(request),
          categoryId,
          name: body.name,
        }),
      );
    } catch (error) {
      throw mapCategoryError(error);
    }
  }

  private actorId(request: FastifyRequest): string {
    const actor = this.actors.get(request);
    if (actor === undefined) throw new UnauthorizedException();
    return actor.id;
  }
}

function mapCategory(category: Category): CategoryResponse {
  const snapshot = category.toSnapshot();
  return {
    createdAt: snapshot.createdAt.toISOString(),
    id: snapshot.id,
    name: snapshot.name,
    parentCategoryId: snapshot.parentCategoryId,
    updatedAt: snapshot.updatedAt.toISOString(),
    version: snapshot.version,
  };
}

function mapCategoryError(error: unknown): Error {
  if (error instanceof OwnedCategoryNotFoundError) {
    return new NotFoundException('Category not found.');
  }
  if (error instanceof CategoryVersionConflictError) {
    return new ConflictException('Category was modified concurrently.');
  }
  if (
    error instanceof InvalidCategoryError ||
    error instanceof InvalidCategoryParentError
  ) {
    return new BadRequestException('Invalid category operation.');
  }
  return error instanceof Error ? error : new Error('Unknown category error.');
}

function createCategoryBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: {
      name: { minLength: 1, type: 'string' },
      parentCategoryId: { format: 'uuid', nullable: true, type: 'string' },
    },
    required: ['name', 'parentCategoryId'],
    type: 'object',
  };
}

function renameCategoryBodySchema(): SchemaObject {
  return {
    additionalProperties: false,
    properties: { name: { minLength: 1, type: 'string' } },
    required: ['name'],
    type: 'object',
  };
}
