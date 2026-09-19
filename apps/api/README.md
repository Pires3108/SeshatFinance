# @seshat/api

NestJS/Fastify presentation process. Controllers validate external input, resolve authorization, call application use cases, and map results to public contracts. They never access Prisma directly.

## Production dependency rationale

- `@nestjs/common`, `@nestjs/core`, and `@nestjs/platform-fastify`: API composition and HTTP presentation framework selected by the architecture.
- `fastify` and `@fastify/static`: HTTP runtime and the static assets required by the generated Swagger UI.
- `@nestjs/swagger`: versioned OpenAPI generation and interactive API documentation.
- `zod`: validation of untrusted input at presentation boundaries.
- `pino`: structured backend logs without financial or personal content.
- `reflect-metadata` and `rxjs`: NestJS runtime requirements.

## Contract

Run `pnpm openapi:generate` after changing controllers or public schemas. CI rejects an `openapi.json` file that is not synchronized with the implementation.
