import { generateKeyPairSync } from "node:crypto";
const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = pair.privateKey.export({ format: "jwk" });
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");
console.log("VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + jwk.d);
console.log("VAPID_SUBJECT=mailto:you@example.com");
console.error("Keep VAPID_PRIVATE_KEY private. Do not commit these values.");
