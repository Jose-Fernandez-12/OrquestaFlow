import { FastifyInstance } from 'fastify';
import { CredentialError, createCredential, deleteCredential, listCredentials, updateCredential, type CredentialInput } from '../engine/credentials.js';

export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  const guarded = <T>(reply: any, action: () => T) => {
    try {
      return { data: action() };
    } catch (err: any) {
      if (err instanceof CredentialError) return reply.status(err.status).send({ error: err.message });
      throw err;
    }
  };

  // What exists and where it is used; never the secrets
  app.get('/', async () => ({ data: listCredentials() }));

  app.post<{ Body: CredentialInput }>('/', async (request, reply) => guarded(reply, () => createCredential(request.body || {})));

  // An empty `secret` keeps the saved one
  app.put<{ Params: { id: string }; Body: CredentialInput }>('/:id', async (request, reply) =>
    guarded(reply, () => updateCredential(request.params.id, request.body || {})));

  // Refused while a connection or a flow still uses it
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) =>
    guarded(reply, () => { deleteCredential(request.params.id); return { deleted: true }; }));
}
