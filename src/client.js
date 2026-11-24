import { simulatedClient } from './simulated.js';

export async function getClient(real) {
  if (!real) return { client: simulatedClient(), model: 'simulated' };
  try { process.loadEnvFile(); } catch { /* .env is optional */ }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return { client: new Anthropic(), model: process.env.MODEL || 'claude-opus-5-5' };
}
