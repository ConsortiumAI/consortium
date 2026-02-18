import { KeyTree, crypto } from "privacy-kit";

let keyTree: KeyTree | null = null;

export async function initEncrypt() {
    keyTree = new KeyTree(await crypto.deriveSecureKey({
        key: process.env.CONSORTIUM_MASTER_SECRET!,
        usage: 'consortium-server-tokens'
    }));
}
