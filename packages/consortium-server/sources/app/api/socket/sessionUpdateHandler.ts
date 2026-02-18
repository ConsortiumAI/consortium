import { buildNewMessageUpdate, buildSessionActivityEphemeral, buildUpdateSessionUpdate, ClientConnection, eventRouter } from "../../events/eventRouter";
import { db } from "../../../storage/db";
import { allocateSessionSeq, allocateUserSeq } from "../../../storage/seq";
import { log } from "../../../utils/log";
import { randomKeyNaked } from "../../../utils/randomKeyNaked";
import { Socket } from "socket.io";

export function sessionUpdateHandler(userId: string, socket: Socket, connection: ClientConnection) {
    socket.on('update-metadata', async (data: any, callback: (response: any) => void) => {
        try {
            const { sid, metadata, expectedVersion } = data;
            if (!sid || typeof metadata !== 'string' || typeof expectedVersion !== 'number') {
                if (callback) callback({ result: 'error' });
                return;
            }

            const session = await db.session.findUnique({ where: { id: sid, accountId: userId } });
            if (!session) return;

            if (session.metadataVersion !== expectedVersion) {
                callback({ result: 'version-mismatch', version: session.metadataVersion, metadata: session.metadata });
                return;
            }

            const { count } = await db.session.updateMany({
                where: { id: sid, metadataVersion: expectedVersion },
                data: { metadata, metadataVersion: expectedVersion + 1 }
            });
            if (count === 0) {
                callback({ result: 'version-mismatch', version: session.metadataVersion, metadata: session.metadata });
                return;
            }

            const updSeq = await allocateUserSeq(userId);
            const metadataUpdate = { value: metadata, version: expectedVersion + 1 };
            const updatePayload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), metadataUpdate);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'all-interested-in-session', sessionId: sid }
            });

            callback({ result: 'success', version: expectedVersion + 1, metadata });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in update-metadata: ${error}`);
            if (callback) callback({ result: 'error' });
        }
    });

    socket.on('update-state', async (data: any, callback: (response: any) => void) => {
        try {
            const { sid, agentState, expectedVersion } = data;
            if (!sid || (typeof agentState !== 'string' && agentState !== null) || typeof expectedVersion !== 'number') {
                if (callback) callback({ result: 'error' });
                return;
            }

            const session = await db.session.findUnique({ where: { id: sid, accountId: userId } });
            if (!session) { callback({ result: 'error' }); return; }

            if (session.agentStateVersion !== expectedVersion) {
                callback({ result: 'version-mismatch', version: session.agentStateVersion, agentState: session.agentState });
                return;
            }

            const { count } = await db.session.updateMany({
                where: { id: sid, agentStateVersion: expectedVersion },
                data: { agentState, agentStateVersion: expectedVersion + 1 }
            });
            if (count === 0) {
                callback({ result: 'version-mismatch', version: session.agentStateVersion, agentState: session.agentState });
                return;
            }

            const updSeq = await allocateUserSeq(userId);
            const agentStateUpdate = { value: agentState, version: expectedVersion + 1 };
            const updatePayload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), undefined, agentStateUpdate);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'all-interested-in-session', sessionId: sid }
            });

            callback({ result: 'success', version: expectedVersion + 1, agentState });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in update-state: ${error}`);
            if (callback) callback({ result: 'error' });
        }
    });

    socket.on('session-alive', async (data: { sid: string; time: number; thinking?: boolean }) => {
        try {
            if (!data || typeof data.time !== 'number' || !data.sid) return;

            let t = data.time;
            if (t > Date.now()) t = Date.now();
            if (t < Date.now() - 1000 * 60 * 10) return;

            const { sid, thinking } = data;

            // Verify session belongs to user
            const session = await db.session.findUnique({ where: { id: sid, accountId: userId } });
            if (!session) return;

            // Update lastActiveAt
            await db.session.update({
                where: { id: sid },
                data: { lastActiveAt: new Date(t), active: true }
            });

            const sessionActivity = buildSessionActivityEphemeral(sid, true, t, thinking || false);
            eventRouter.emitEphemeral({
                userId,
                payload: sessionActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in session-alive: ${error}`);
        }
    });

    socket.on('message', async (data: any) => {
        try {
            const { sid, message, localId } = data;

            const session = await db.session.findUnique({ where: { id: sid, accountId: userId } });
            if (!session) return;

            let useLocalId = typeof localId === 'string' ? localId : null;

            const msgContent = { t: 'encrypted', c: message };
            const updSeq = await allocateUserSeq(userId);
            const msgSeq = await allocateSessionSeq(sid);

            if (useLocalId) {
                const existing = await db.sessionMessage.findFirst({
                    where: { sessionId: sid, localId: useLocalId }
                });
                if (existing) return;
            }

            const msg = await db.sessionMessage.create({
                data: { sessionId: sid, seq: msgSeq, content: msgContent, localId: useLocalId }
            });

            const updatePayload = buildNewMessageUpdate(msg, sid, updSeq, randomKeyNaked(12));
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
                skipSenderConnection: connection
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in message handler: ${error}`);
        }
    });

    socket.on('session-end', async (data: { sid: string; time: number }) => {
        try {
            const { sid, time } = data;
            let t = time;
            if (typeof t !== 'number') return;
            if (t > Date.now()) t = Date.now();
            if (t < Date.now() - 1000 * 60 * 10) return;

            const session = await db.session.findUnique({ where: { id: sid, accountId: userId } });
            if (!session) return;

            await db.session.update({
                where: { id: sid },
                data: { lastActiveAt: new Date(t), active: false }
            });

            const sessionActivity = buildSessionActivityEphemeral(sid, false, t, false);
            eventRouter.emitEphemeral({
                userId,
                payload: sessionActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in session-end: ${error}`);
        }
    });
}
