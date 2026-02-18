import * as privacyKit from "privacy-kit";
import { log } from "../../utils/log";

interface TokenCacheEntry {
    userId: string;
    extras?: any;
    cachedAt: number;
}

class AuthModule {
    private tokenCache = new Map<string, TokenCacheEntry>();
    private tokens: {
        generator: Awaited<ReturnType<typeof privacyKit.createPersistentTokenGenerator>>;
        verifier: Awaited<ReturnType<typeof privacyKit.createPersistentTokenVerifier>>;
    } | null = null;

    async init(): Promise<void> {
        if (this.tokens) return;

        log({ module: 'auth' }, 'Initializing auth module...');

        const generator = await privacyKit.createPersistentTokenGenerator({
            service: 'consortium',
            seed: process.env.CONSORTIUM_MASTER_SECRET!
        });

        const verifier = await privacyKit.createPersistentTokenVerifier({
            service: 'consortium',
            publicKey: Uint8Array.from(generator.publicKey)
        });

        this.tokens = { generator, verifier };
        log({ module: 'auth' }, 'Auth module initialized');
    }

    async createToken(userId: string, extras?: any): Promise<string> {
        if (!this.tokens) throw new Error('Auth module not initialized');

        const payload: any = { user: userId };
        if (extras) payload.extras = extras;

        const token = await this.tokens.generator.new(payload);
        this.tokenCache.set(token, { userId, extras, cachedAt: Date.now() });
        return token;
    }

    async verifyToken(token: string): Promise<{ userId: string; extras?: any } | null> {
        const cached = this.tokenCache.get(token);
        if (cached) return { userId: cached.userId, extras: cached.extras };

        if (!this.tokens) throw new Error('Auth module not initialized');

        try {
            const verified = await this.tokens.verifier.verify(token);
            if (!verified) return null;

            const userId = verified.user as string;
            const extras = verified.extras;
            this.tokenCache.set(token, { userId, extras, cachedAt: Date.now() });
            return { userId, extras };
        } catch (error) {
            log({ module: 'auth', level: 'error' }, `Token verification failed: ${error}`);
            return null;
        }
    }
}

export const auth = new AuthModule();
