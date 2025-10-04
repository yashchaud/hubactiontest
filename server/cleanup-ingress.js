/**
 * Cleanup script to delete all ingresses from LiveKit
 * Run this when you hit ingress limit
 */

import { IngressClient } from 'livekit-server-sdk';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory
dotenv.config({ path: join(__dirname, '../server/.env') });

const LIVEKIT_HOST = process.env.LIVEKIT_WS_URL?.replace('wss://', 'https://') || 'https://localhost';

const ingressClient = new IngressClient(
  LIVEKIT_HOST,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
);

async function cleanupIngresses() {
  try {
    console.log('[Cleanup] Listing all ingresses...');

    const ingresses = await ingressClient.listIngress();

    console.log(`[Cleanup] Found ${ingresses.length} ingress(es)`);

    if (ingresses.length === 0) {
      console.log('[Cleanup] No ingresses to delete');
      return;
    }

    for (const ingress of ingresses) {
      console.log(`[Cleanup] Deleting ingress: ${ingress.ingressId} (${ingress.name})`);
      try {
        await ingressClient.deleteIngress(ingress.ingressId);
        console.log(`[Cleanup] ✅ Deleted: ${ingress.ingressId}`);
      } catch (err) {
        console.error(`[Cleanup] ❌ Error deleting ${ingress.ingressId}:`, err.message);
      }
    }

    console.log('[Cleanup] Done!');

  } catch (error) {
    console.error('[Cleanup] Error:', error);
    process.exit(1);
  }
}

cleanupIngresses();
