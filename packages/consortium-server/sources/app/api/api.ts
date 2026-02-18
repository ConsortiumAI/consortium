import fastify from "fastify";
import { log, logger } from "../../utils/log";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { Fastify } from "./types";
import { authRoutes } from "./routes/authRoutes";
import { sessionRoutes } from "./routes/sessionRoutes";
import { startSocket } from "./socket";
import { machinesRoutes } from "./routes/machinesRoutes";
import { enableAuthentication } from "./utils/enableAuthentication";
import { db } from "../../storage/db";

export async function startApi() {
    log('Starting API...');

    const app = fastify({
        loggerInstance: logger,
        bodyLimit: 1024 * 1024 * 10, // 10MB
    });
    app.register(import('@fastify/cors'), {
        origin: '*',
        allowedHeaders: '*',
        methods: ['GET', 'POST', 'DELETE']
    });
    app.get('/', function (request, reply) {
        reply.send('Welcome to Consortium Relay!');
    });

    // Health check
    app.get('/health', async (request, reply) => {
        try {
            await db.$queryRaw`SELECT 1`;
            reply.send({ status: 'ok', timestamp: new Date().toISOString() });
        } catch (error) {
            reply.code(503).send({ status: 'error', error: 'Database connectivity failed' });
        }
    });

    // Create typed provider
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    // Enable features
    enableAuthentication(typed);

    // Routes
    authRoutes(typed);
    sessionRoutes(typed);
    machinesRoutes(typed);

    // Start HTTP
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3005;
    await app.listen({ port, host: '0.0.0.0' });

    // Start Socket
    startSocket(typed);

    log('API ready on port http://localhost:' + port);
}
