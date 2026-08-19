'use strict';

const fs = require('fs');
const path = require('path');

class StateStore {
  constructor(filePath, fallback, normalize) {
    this.filePath = filePath;
    this.normalize = typeof normalize === 'function' ? normalize : (value) => value;
    this.value = this.normalize(fallback);
    this.revision = 0;
    this.persistedRevision = 0;
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      this.value = this.normalize(JSON.parse(raw));
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`[state-store] load failed: ${this.filePath}`, error.message);
    }
    return this.get();
  }

  get() {
    return this.normalize(this.value);
  }

  patch(patch) {
    this.value = this.normalize({ ...this.value, ...(patch || {}) });
    this.revision += 1;
    return this.get();
  }

  replace(value) {
    this.value = this.normalize(value);
    this.revision += 1;
    return this.get();
  }

  persist() {
    const targetRevision = this.revision;
    const snapshot = JSON.stringify(this.value, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      const dir = path.dirname(this.filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${targetRevision}.tmp`;
      await fs.promises.writeFile(tempPath, snapshot, 'utf8');
      await fs.promises.rename(tempPath, this.filePath);
      this.persistedRevision = Math.max(this.persistedRevision, targetRevision);
    });
    return this.writeChain;
  }

  schedulePersist(delayMs = 0) {
    if (!delayMs) return this.persist();
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist().catch((error) => {
        console.warn(`[state-store] persist failed: ${this.filePath}`, error.message);
      });
    }, delayMs);
    return this.writeChain;
  }

  async flush() {
    clearTimeout(this.persistTimer);
    if (this.persistedRevision < this.revision) this.persist();
    await this.writeChain;
  }
}

module.exports = { StateStore };
