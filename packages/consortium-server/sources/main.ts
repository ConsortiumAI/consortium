import { startApi } from "./app/api/api";
import { log } from "./utils/log";
import { db } from "./storage/db";
import { auth } from "./app/auth/auth";
import { initEncrypt } from "./modules/encrypt";

async function main() {
    // Storage
    await db.$connect();

    // Initialize auth module
    await initEncrypt();
    await auth.init();

    // Start
    await startApi();

    // Ready
    log('Ready');
    await new Promise<void>((resolve) => {
        process.on('SIGINT', () => resolve());
        process.on('SIGTERM', () => resolve());
    });
    log('Shutting down...');
    await db.$disconnect();
}

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

main().catch((e) => {
    console.error(e);
    process.exit(1);
}).then(() => {
    process.exit(0);
});
