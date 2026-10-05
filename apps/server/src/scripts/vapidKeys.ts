import { generateVapidKeys } from "../push/send.js";

// Prints a new VAPID key pair for web push. Copy both lines into .env.local; never commit them
// or paste them anywhere else. Changing keys later means every browser has to subscribe again.

const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(
  "\nAlso set VAPID_SUBJECT=mailto:<your email> (push services contact it about problems).",
);
