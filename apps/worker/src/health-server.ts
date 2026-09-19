import { createServer, type Server } from 'node:http';

export function createHealthServer(): Server {
  return createServer((request, response): void => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ service: 'worker', status: 'ok' }));
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'not-found' }));
  });
}
