// Utility functions for Gemini Chat Edge Function
/// <reference path="../types/deno.d.ts" />

import type { SourceFile } from "./types.ts";

export function getEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export function parseBooleanEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
}

export function truncateText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}…`;
}

export function formatSek(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 }).format(
    value,
  );
}

// ============================================================
// Voucher Attachment Helpers
// ============================================================

const ATTACHABLE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp'];

export function isAttachableFile(fileName: string): boolean {
  return ATTACHABLE_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));
}

export function inferMimeType(fileName: string): string {
  const ext = (fileName.toLowerCase().split('.').pop() || '');
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return map[ext] || 'application/octet-stream';
}

export function extractStoragePath(fileUrl: string): string {
  try {
    const url = new URL(fileUrl);
    const match = url.pathname.match(/\/storage\/v1\/object\/sign\/chat-files\/(.+)/);
    return match ? decodeURIComponent(match[1]) : '';
  } catch {
    return '';
  }
}

// deno-lint-ignore no-explicit-any
export function findSourceFile(history: any[]): SourceFile | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'user' && msg.file_name && isAttachableFile(msg.file_name) && msg.file_url) {
      const storagePath = extractStoragePath(msg.file_url);
      if (storagePath) {
        return {
          storage_path: storagePath,
          file_name: msg.file_name,
          mime_type: inferMimeType(msg.file_name),
        };
      }
    }
  }
  return undefined;
}

export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function clampScore(value: unknown, fallback: number): number {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

export function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
