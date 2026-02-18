import { eventRouter, buildNewSessionUpdate } from "../../events/eventRouter";
import { type Fastify } from "../types";
import { db } from "../../../storage/db";
import { z } from "zod";
import { log } from "../../../utils/log";
import { randomKeyNaked } from "../../../utils/randomKeyNaked";
import { allocateUserSeq } from "../../../storage/seq";
import { sessionDelete } from "../../session/sessionDelete";

export function sessionRoutes(app: Fastify) {

    // List sessions
    app.get('/v1/sessions', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;

        const sessions = await db.session.findMany({
            where: { accountId: userId },
            orderBy: { updatedAt: 'desc' },
            take: 150,
            select: {
                id: true,
                seq: true,
                createdAt: true,
                updatedAt: true,
                metadata: true,
                metadataVersion: true,
                agentState: true,
                agentStateVersion: true,
                dataEncryptionKey: true,
                active: true,
                lastActiveAt: true,
            }
        });

        return reply.send({
            sessions: sessions.map((v) => ({
                id: v.id,
                seq: v.seq,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime(),
                active: v.active,
                activeAt: v.lastActiveAt.getTime(),
                metadata: v.metadata,
                metadataVersion: v.metadataVersion,
                agentState: v.agentState,
                agentStateVersion: v.agentStateVersion,
                dataEncryptionKey: v.dataEncryptionKey ? Buffer.from(v.dataEncryptionKey).toString('base64') : null,
                lastMessage: null
            }))
        });
    });

    // Create or load session by tag
    app.post('/v1/sessions', {
        schema: {
            body: z.object({
                tag: z.string(),
                metadata: z.string(),
                agentState: z.string().nullish(),
                dataEncryptionKey: z.string().nullish()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { tag, metadata, dataEncryptionKey } = request.body;

        const session = await db.session.findFirst({
            where: { accountId: userId, tag: tag }
        });
        if (session) {
            return reply.send({
                session: {
                    id: session.id,
                    seq: session.seq,
                    metadata: session.metadata,
                    metadataVersion: session.metadataVersion,
                    agentState: session.agentState,
                    agentStateVersion: session.agentStateVersion,
                    dataEncryptionKey: session.dataEncryptionKey ? Buffer.from(session.dataEncryptionKey).toString('base64') : null,
                    active: session.active,
                    activeAt: session.lastActiveAt.getTime(),
                    createdAt: session.createdAt.getTime(),
                    updatedAt: session.updatedAt.getTime(),
                    lastMessage: null
                }
            });
        }

        // Resolve seq
        const updSeq = await allocateUserSeq(userId);

        // Create session
        const newSession = await db.session.create({
            data: {
                accountId: userId,
                tag: tag,
                metadata: metadata,
                dataEncryptionKey: dataEncryptionKey ? new Uint8Array(Buffer.from(dataEncryptionKey, 'base64')) : undefined
            }
        });

        // Emit new session update
        const updatePayload = buildNewSessionUpdate(newSession, updSeq, randomKeyNaked(12));
        eventRouter.emitUpdate({
            userId,
            payload: updatePayload,
            recipientFilter: { type: 'user-scoped-only' }
        });

        return reply.send({
            session: {
                id: newSession.id,
                seq: newSession.seq,
                metadata: newSession.metadata,
                metadataVersion: newSession.metadataVersion,
                agentState: newSession.agentState,
                agentStateVersion: newSession.agentStateVersion,
                dataEncryptionKey: newSession.dataEncryptionKey ? Buffer.from(newSession.dataEncryptionKey).toString('base64') : null,
                active: newSession.active,
                activeAt: newSession.lastActiveAt.getTime(),
                createdAt: newSession.createdAt.getTime(),
                updatedAt: newSession.updatedAt.getTime(),
                lastMessage: null
            }
        });
    });

    // Get session messages
    app.get('/v1/sessions/:sessionId/messages', {
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        const session = await db.session.findFirst({
            where: { id: sessionId, accountId: userId }
        });
        if (!session) {
            return reply.code(404).send({ error: 'Session not found' });
        }

        const messages = await db.sessionMessage.findMany({
            where: { sessionId },
            orderBy: { createdAt: 'desc' },
            take: 150,
            select: {
                id: true,
                seq: true,
                localId: true,
                content: true,
                createdAt: true,
                updatedAt: true
            }
        });

        return reply.send({
            messages: messages.map((v) => ({
                id: v.id,
                seq: v.seq,
                content: v.content,
                localId: v.localId,
                createdAt: v.createdAt.getTime(),
                updatedAt: v.updatedAt.getTime()
            }))
        });
    });

    // Delete session
    app.delete('/v1/sessions/:sessionId', {
        schema: {
            params: z.object({
                sessionId: z.string()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId } = request.params;

        const deleted = await sessionDelete({ uid: userId }, sessionId);
        if (!deleted) {
            return reply.code(404).send({ error: 'Session not found or not owned by user' });
        }

        return reply.send({ success: true });
    });
}
