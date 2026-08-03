import {
  decodeBlobCompact,
  decryptJson,
  encodeBlobCompact,
  encryptJson,
  type EncryptedBlob,
} from "./crypto";

export type AuthMethod = "password" | "privateKey";

export type ServerProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  createdAt: string;
  updatedAt: string;
};

export type VaultData = {
  version: 1;
  servers: ServerProfile[];
};

export type VaultExportFile = {
  app: "openterm";
  kind: "vault";
  exportedAt: string;
  blob: EncryptedBlob;
};

const STORAGE_KEY = "openterm.vault.v1";
const META_KEY = "openterm.vault.meta.v1";

export type VaultMeta = {
  hasVault: boolean;
  updatedAt?: string;
  serverCount?: number;
};

function emptyVault(): VaultData {
  return { version: 1, servers: [] };
}

export function readVaultMeta(): VaultMeta {
  const raw = localStorage.getItem(META_KEY);
  if (!raw) {
    return { hasVault: Boolean(localStorage.getItem(STORAGE_KEY)) };
  }
  try {
    return JSON.parse(raw) as VaultMeta;
  } catch {
    return { hasVault: Boolean(localStorage.getItem(STORAGE_KEY)) };
  }
}

function writeMeta(vault: VaultData) {
  const meta: VaultMeta = {
    hasVault: true,
    updatedAt: new Date().toISOString(),
    serverCount: vault.servers.length,
  };
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export async function createVault(masterPassword: string): Promise<VaultData> {
  const vault = emptyVault();
  await persistVault(vault, masterPassword);
  return vault;
}

export async function unlockVault(masterPassword: string): Promise<VaultData> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    throw new Error("Vault not found on this device");
  }
  const blob = JSON.parse(raw) as EncryptedBlob;
  return decryptJson<VaultData>(blob, masterPassword);
}

export async function persistVault(vault: VaultData, masterPassword: string): Promise<void> {
  const blob = await encryptJson(vault, masterPassword);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
  writeMeta(vault);
}

export async function changeMasterPassword(
  vault: VaultData,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  // Verify old password first.
  await unlockVault(oldPassword);
  await persistVault(vault, newPassword);
}

export async function exportEncryptedVault(masterPassword: string): Promise<VaultExportFile> {
  const vault = await unlockVault(masterPassword);
  const blob = await encryptJson(vault, masterPassword);
  return {
    app: "openterm",
    kind: "vault",
    exportedAt: new Date().toISOString(),
    blob,
  };
}

export async function exportCompactPayload(masterPassword: string): Promise<string> {
  const file = await exportEncryptedVault(masterPassword);
  return encodeBlobCompact(file.blob);
}

export async function importEncryptedVault(
  file: VaultExportFile,
  masterPassword: string,
): Promise<VaultData> {
  if (file.app !== "openterm" || file.kind !== "vault") {
    throw new Error("Not an OpenTerm vault file");
  }
  const vault = await decryptJson<VaultData>(file.blob, masterPassword);
  await persistVault(vault, masterPassword);
  return vault;
}

export async function importCompactPayload(
  payload: string,
  masterPassword: string,
): Promise<VaultData> {
  const blob = decodeBlobCompact(payload);
  const vault = await decryptJson<VaultData>(blob, masterPassword);
  await persistVault(vault, masterPassword);
  return vault;
}

export function clearVaultFromDevice(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(META_KEY);
}

export function upsertServer(vault: VaultData, profile: ServerProfile): VaultData {
  const idx = vault.servers.findIndex((s) => s.id === profile.id);
  const servers = [...vault.servers];
  if (idx >= 0) servers[idx] = profile;
  else servers.push(profile);
  return { ...vault, servers };
}

export function removeServer(vault: VaultData, id: string): VaultData {
  return { ...vault, servers: vault.servers.filter((s) => s.id !== id) };
}

export function newServerId(): string {
  return crypto.randomUUID();
}
