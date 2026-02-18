import { eventRouter, buildNewMachineUpdate, buildUpdateMachineUpdate } from "../../events/eventRouter";
import { Fastify } from "../types";
import { z } from "zod";
import { db } from "../../../storage/db";
import { log } from "../../../utils/log";
import { randomKeyNaked } from "../../../utils/randomKeyNaked";
import { allocateUserSeq } from "../../../storage/seq";

export function machinesRoutes(app: Fastify) {
    app.post('/v1/machines', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                id: z.string(),
                metadata: z.string(),
                daemonState: z.string().optional(),
                dataEncryptionKey: z.string().nullish(),
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id, metadata, daemonState, dataEncryptionKey } = request.body;

        const machine = await db.machine.findFirst({
            where: { accountId: userId, id: id }
        });

        if (machine) {
            return reply.send({
                machine: {
                    id: machine.id,
                    metadata: machine.metadata,
                    metadataVersion: machine.metadataVersion,
                    daemonState: machine.daemonState,
                    daemonStateVersion: machine.daemonStateVersion,
                    dataEncryptionKey: machine.dataEncryptionKey ? Buffer.from(machine.dataEncryptionKey).toString('base64') : null,
                    active: machine.active,
                    activeAt: machine.lastActiveAt.getTime(),
                    createdAt: machine.createdAt.getTime(),
                    updatedAt: machine.updatedAt.getTime()
                }
            });
        }

        const newMachine = await db.machine.create({
            data: {
                id,
                accountId: userId,
                metadata,
                metadataVersion: 1,
                daemonState: daemonState || null,
                daemonStateVersion: daemonState ? 1 : 0,
                dataEncryptionKey: dataEncryptionKey ? new Uint8Array(Buffer.from(dataEncryptionKey, 'base64')) : undefined,
                active: false,
            }
        });

        const updSeq1 = await allocateUserSeq(userId);
        const updSeq2 = await allocateUserSeq(userId);

        const newMachinePayload = buildNewMachineUpdate(newMachine, updSeq1, randomKeyNaked(12));
        eventRouter.emitUpdate({
            userId,
            payload: newMachinePayload,
            recipientFilter: { type: 'user-scoped-only' }
        });

        const machineMetadata = { version: 1, value: metadata };
        const updatePayload = buildUpdateMachineUpdate(newMachine.id, updSeq2, randomKeyNaked(12), machineMetadata);
        eventRouter.emitUpdate({
            userId,
            payload: updatePayload,
            recipientFilter: { type: 'machine-scoped-only', machineId: newMachine.id }
        });

        return reply.send({
            machine: {
                id: newMachine.id,
                metadata: newMachine.metadata,
                metadataVersion: newMachine.metadataVersion,
                daemonState: newMachine.daemonState,
                daemonStateVersion: newMachine.daemonStateVersion,
                dataEncryptionKey: newMachine.dataEncryptionKey ? Buffer.from(newMachine.dataEncryptionKey).toString('base64') : null,
                active: newMachine.active,
                activeAt: newMachine.lastActiveAt.getTime(),
                createdAt: newMachine.createdAt.getTime(),
                updatedAt: newMachine.updatedAt.getTime()
            }
        });
    });

    app.get('/v1/machines', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const machines = await db.machine.findMany({
            where: { accountId: userId },
            orderBy: { lastActiveAt: 'desc' }
        });

        return machines.map(m => ({
            id: m.id,
            metadata: m.metadata,
            metadataVersion: m.metadataVersion,
            daemonState: m.daemonState,
            daemonStateVersion: m.daemonStateVersion,
            dataEncryptionKey: m.dataEncryptionKey ? Buffer.from(m.dataEncryptionKey).toString('base64') : null,
            seq: m.seq,
            active: m.active,
            activeAt: m.lastActiveAt.getTime(),
            createdAt: m.createdAt.getTime(),
            updatedAt: m.updatedAt.getTime()
        }));
    });

    app.get('/v1/machines/:id', {
        preHandler: app.authenticate,
        schema: { params: z.object({ id: z.string() }) }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const machine = await db.machine.findFirst({ where: { accountId: userId, id } });
        if (!machine) {
            return reply.code(404).send({ error: 'Machine not found' });
        }
        return {
            machine: {
                id: machine.id,
                metadata: machine.metadata,
                metadataVersion: machine.metadataVersion,
                daemonState: machine.daemonState,
                daemonStateVersion: machine.daemonStateVersion,
                dataEncryptionKey: machine.dataEncryptionKey ? Buffer.from(machine.dataEncryptionKey).toString('base64') : null,
                seq: machine.seq,
                active: machine.active,
                activeAt: machine.lastActiveAt.getTime(),
                createdAt: machine.createdAt.getTime(),
                updatedAt: machine.updatedAt.getTime()
            }
        };
    });
}
