import { Fastify } from "./types";
import { buildMachineActivityEphemeral, ClientConnection, eventRouter } from "../events/eventRouter";
import { Server, Socket } from "socket.io";
import { log } from "../../utils/log";
import { auth } from "../auth/auth";
import { rpcHandler } from "./socket/rpcHandler";
import { sessionUpdateHandler } from "./socket/sessionUpdateHandler";
import { machineUpdateHandler } from "./socket/machineUpdateHandler";

export function startSocket(app: Fastify) {
    const io = new Server(app.server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST", "OPTIONS"],
            credentials: false,
            allowedHeaders: ["*"]
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 45000,
        pingInterval: 15000,
        path: '/v1/updates',
        allowUpgrades: true,
        upgradeTimeout: 10000,
        connectTimeout: 20000,
        serveClient: false
    });

    let rpcListeners = new Map<string, Map<string, Socket>>();
    io.on("connection", async (socket) => {
        log({ module: 'websocket' }, `New connection attempt from socket: ${socket.id}`);
        const token = socket.handshake.auth.token as string;
        const clientType = socket.handshake.auth.clientType as 'session-scoped' | 'user-scoped' | 'machine-scoped' | undefined;
        const sessionId = socket.handshake.auth.sessionId as string | undefined;
        const machineId = socket.handshake.auth.machineId as string | undefined;

        if (!token) {
            socket.emit('error', { message: 'Missing authentication token' });
            socket.disconnect();
            return;
        }

        if (clientType === 'session-scoped' && !sessionId) {
            socket.emit('error', { message: 'Session ID required for session-scoped clients' });
            socket.disconnect();
            return;
        }

        if (clientType === 'machine-scoped' && !machineId) {
            socket.emit('error', { message: 'Machine ID required for machine-scoped clients' });
            socket.disconnect();
            return;
        }

        const verified = await auth.verifyToken(token);
        if (!verified) {
            socket.emit('error', { message: 'Invalid authentication token' });
            socket.disconnect();
            return;
        }

        const userId = verified.userId;
        log({ module: 'websocket' }, `Token verified: ${userId}, clientType: ${clientType || 'user-scoped'}, sessionId: ${sessionId || 'none'}, machineId: ${machineId || 'none'}`);

        // Store connection based on type
        let connection: ClientConnection;
        if (clientType === 'session-scoped' && sessionId) {
            connection = { connectionType: 'session-scoped', socket, userId, sessionId };
        } else if (clientType === 'machine-scoped' && machineId) {
            connection = { connectionType: 'machine-scoped', socket, userId, machineId };
        } else {
            connection = { connectionType: 'user-scoped', socket, userId };
        }
        eventRouter.addConnection(userId, connection);

        // Broadcast daemon online status
        if (connection.connectionType === 'machine-scoped') {
            const machineActivity = buildMachineActivityEphemeral(machineId!, true, Date.now());
            eventRouter.emitEphemeral({
                userId,
                payload: machineActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        }

        socket.on('disconnect', () => {
            eventRouter.removeConnection(userId, connection);
            log({ module: 'websocket' }, `User disconnected: ${userId}`);

            if (connection.connectionType === 'machine-scoped') {
                const machineActivity = buildMachineActivityEphemeral(connection.machineId, false, Date.now());
                eventRouter.emitEphemeral({
                    userId,
                    payload: machineActivity,
                    recipientFilter: { type: 'user-scoped-only' }
                });
            }
        });

        // Handlers
        let userRpcListeners = rpcListeners.get(userId);
        if (!userRpcListeners) {
            userRpcListeners = new Map<string, Socket>();
            rpcListeners.set(userId, userRpcListeners);
        }
        rpcHandler(userId, socket, userRpcListeners);
        sessionUpdateHandler(userId, socket, connection);
        machineUpdateHandler(userId, socket);

        log({ module: 'websocket' }, `User connected: ${userId}`);
    });
}
