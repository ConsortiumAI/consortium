import { buildMachineActivityEphemeral, buildUpdateMachineUpdate, eventRouter } from "../../events/eventRouter";
import { log } from "../../../utils/log";
import { db } from "../../../storage/db";
import { Socket } from "socket.io";
import { allocateUserSeq } from "../../../storage/seq";
import { randomKeyNaked } from "../../../utils/randomKeyNaked";

export function machineUpdateHandler(userId: string, socket: Socket) {
    socket.on('machine-alive', async (data: { machineId: string; time: number }) => {
        try {
            if (!data || typeof data.time !== 'number' || !data.machineId) return;

            let t = data.time;
            if (t > Date.now()) t = Date.now();
            if (t < Date.now() - 1000 * 60 * 10) return;

            const machine = await db.machine.findFirst({ where: { accountId: userId, id: data.machineId } });
            if (!machine) return;

            await db.machine.update({
                where: { id: data.machineId },
                data: { lastActiveAt: new Date(t), active: true }
            });

            const machineActivity = buildMachineActivityEphemeral(data.machineId, true, t);
            eventRouter.emitEphemeral({
                userId,
                payload: machineActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in machine-alive: ${error}`);
        }
    });

    socket.on('machine-update-metadata', async (data: any, callback: (response: any) => void) => {
        try {
            const { machineId, metadata, expectedVersion } = data;
            if (!machineId || typeof metadata !== 'string' || typeof expectedVersion !== 'number') {
                if (callback) callback({ result: 'error', message: 'Invalid parameters' });
                return;
            }

            const machine = await db.machine.findFirst({ where: { accountId: userId, id: machineId } });
            if (!machine) {
                if (callback) callback({ result: 'error', message: 'Machine not found' });
                return;
            }

            if (machine.metadataVersion !== expectedVersion) {
                callback({ result: 'version-mismatch', version: machine.metadataVersion, metadata: machine.metadata });
                return;
            }

            const { count } = await db.machine.updateMany({
                where: { accountId: userId, id: machineId, metadataVersion: expectedVersion },
                data: { metadata, metadataVersion: expectedVersion + 1 }
            });

            if (count === 0) {
                const current = await db.machine.findFirst({ where: { accountId: userId, id: machineId } });
                callback({ result: 'version-mismatch', version: current?.metadataVersion || 0, metadata: current?.metadata });
                return;
            }

            const updSeq = await allocateUserSeq(userId);
            const metadataUpdate = { value: metadata, version: expectedVersion + 1 };
            const updatePayload = buildUpdateMachineUpdate(machineId, updSeq, randomKeyNaked(12), metadataUpdate);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'machine-scoped-only', machineId }
            });

            callback({ result: 'success', version: expectedVersion + 1, metadata });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in machine-update-metadata: ${error}`);
            if (callback) callback({ result: 'error', message: 'Internal error' });
        }
    });

    socket.on('machine-update-state', async (data: any, callback: (response: any) => void) => {
        try {
            const { machineId, daemonState, expectedVersion } = data;
            if (!machineId || typeof daemonState !== 'string' || typeof expectedVersion !== 'number') {
                if (callback) callback({ result: 'error', message: 'Invalid parameters' });
                return;
            }

            const machine = await db.machine.findFirst({ where: { accountId: userId, id: machineId } });
            if (!machine) {
                if (callback) callback({ result: 'error', message: 'Machine not found' });
                return;
            }

            if (machine.daemonStateVersion !== expectedVersion) {
                callback({ result: 'version-mismatch', version: machine.daemonStateVersion, daemonState: machine.daemonState });
                return;
            }

            const { count } = await db.machine.updateMany({
                where: { accountId: userId, id: machineId, daemonStateVersion: expectedVersion },
                data: { daemonState, daemonStateVersion: expectedVersion + 1, active: true, lastActiveAt: new Date() }
            });

            if (count === 0) {
                const current = await db.machine.findFirst({ where: { accountId: userId, id: machineId } });
                callback({ result: 'version-mismatch', version: current?.daemonStateVersion || 0, daemonState: current?.daemonState });
                return;
            }

            const updSeq = await allocateUserSeq(userId);
            const daemonStateUpdate = { value: daemonState, version: expectedVersion + 1 };
            const updatePayload = buildUpdateMachineUpdate(machineId, updSeq, randomKeyNaked(12), undefined, daemonStateUpdate);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'machine-scoped-only', machineId }
            });

            callback({ result: 'success', version: expectedVersion + 1, daemonState });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in machine-update-state: ${error}`);
            if (callback) callback({ result: 'error', message: 'Internal error' });
        }
    });
}
