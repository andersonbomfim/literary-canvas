import fs from 'node:fs';
import path from 'node:path';
import { ENV } from './_core/env';

type StorageConfig = { baseUrl: string; apiKey: string };
const LOCAL_EXPORTS_DIR = path.resolve(process.cwd(), '.local-exports');

function getStorageConfig(): StorageConfig | null {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeKey(relKey: string): string {
  // Mais que strip de leading slash: rejeita path traversal explícito.
  // `path.join(BASE, "../etc/passwd")` resolve fora do sandbox; bloquear aqui
  // evita que qualquer caller futuro com input do usuário no caminho exponha
  // arquivos arbitrários. Mantém a interface (string) — callers que precisam
  // de subpaths usam separadores normais.
  const cleaned = relKey.replace(/^\/+/, '');
  if (cleaned.split(/[\\/]+/).some((segment) => segment === '..' || segment === '.')) {
    throw new Error(`Caminho de storage inválido: ${relKey}`);
  }
  return cleaned;
}

function ensureInsideBase(targetPath: string, baseDir: string) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)) {
    throw new Error(`Caminho de storage escapa do diretório base: ${targetPath}`);
  }
  return resolvedTarget;
}

function buildUploadUrl(baseUrl: string, relKey: string): URL {
  const url = new URL('v1/storage/upload', ensureTrailingSlash(baseUrl));
  url.searchParams.set('path', normalizeKey(relKey));
  return url;
}

async function buildDownloadUrl(baseUrl: string, relKey: string, apiKey: string): Promise<string> {
  const downloadApiUrl = new URL('v1/storage/downloadUrl', ensureTrailingSlash(baseUrl));
  downloadApiUrl.searchParams.set('path', normalizeKey(relKey));
  const response = await fetch(downloadApiUrl, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } });
  return (await response.json()).url;
}

function toFormData(data: Buffer | Uint8Array | string, contentType: string, fileName: string): FormData {
  const blob = typeof data === 'string' ? new Blob([data], { type: contentType }) : new Blob([data as any], { type: contentType });
  const form = new FormData();
  form.append('file', blob, fileName || 'file');
  return form;
}

function localWrite(relKey: string, data: Buffer | Uint8Array | string) {
  const key = normalizeKey(relKey);
  const fullPath = ensureInsideBase(path.join(LOCAL_EXPORTS_DIR, key), LOCAL_EXPORTS_DIR);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (typeof data === 'string') fs.writeFileSync(fullPath, data, 'utf8');
  else fs.writeFileSync(fullPath, Buffer.from(data));
  return { key, url: `/local-exports/${key}` };
}

export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, contentType = 'application/octet-stream'): Promise<{ key: string; url: string }> {
  const config = getStorageConfig();
  if (!config) return localWrite(relKey, data);

  const key = normalizeKey(relKey);
  const uploadUrl = buildUploadUrl(config.baseUrl, key);
  const formData = toFormData(data, contentType, key.split('/').pop() ?? key);
  const response = await fetch(uploadUrl, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}` }, body: formData });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Storage upload failed (${response.status} ${response.statusText}): ${message}`);
  }
  const url = (await response.json()).url;
  return { key, url };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const config = getStorageConfig();
  const key = normalizeKey(relKey);
  if (!config) return { key, url: `/local-exports/${key}` };
  return { key, url: await buildDownloadUrl(config.baseUrl, key, config.apiKey) };
}
