import fs from 'node:fs';
import path from 'node:path';

export class JsonVaultStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.vaults = new Map();
    this.#load();
  }

  #load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const vault of parsed.vaults ?? []) this.vaults.set(vault.id, vault);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  #persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ vaults: [...this.vaults.values()] }, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  all() { return [...this.vaults.values()].map(v => structuredClone(v)); }
  get(id) { const value = this.vaults.get(id); return value ? structuredClone(value) : null; }
  put(vault) { this.vaults.set(vault.id, structuredClone(vault)); this.#persist(); return this.get(vault.id); }
}
