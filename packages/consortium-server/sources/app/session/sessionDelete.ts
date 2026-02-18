import { Context } from "../../context";
import { inTx, afterTx } from "../../storage/inTx";
import { eventRouter, buildDeleteSessionUpdate } from "../events/eventRouter";
import { allocateUserSeq } from "../../storage/seq";
import { randomKeyNaked } from "../../utils/randomKeyNaked";
import { log } from "../../utils/log";

/**
 * Delete a session and all its related data.
 */
export async function sessionDelete(ctx: Context, sessionId: string): Promise<boolean> {
    return await inTx(async (tx) => {
        const session = await tx.session.findFirst({
            where: { id: sessionId, accountId: ctx.uid }
        });

        if (!session) return false;

        // Delete session messages
        await tx.sessionMessage.deleteMany({ where: { sessionId } });

        // Delete the session
        await tx.session.delete({ where: { id: sessionId } });

        // Send notification after transaction commits
        afterTx(tx, async () => {
            const updSeq = await allocateUserSeq(ctx.uid);
            const updatePayload = buildDeleteSessionUpdate(sessionId, updSeq, randomKeyNaked(12));
            eventRouter.emitUpdate({
                userId: ctx.uid,
                payload: updatePayload,
                recipientFilter: { type: 'user-scoped-only' }
            });
        });

        return true;
    });
}
