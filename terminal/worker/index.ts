import { handleRequest, type WorkerEnv } from './core';

// The entry module must export nothing but the handler: the Workers runtime
// treats every named export here as a handler binding.
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
