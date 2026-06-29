import { config } from './config.js';

export class RequestQueue {
  constructor(maxDepth = 1) {
    this.maxDepth = maxDepth;
    this.activeId = null;
    this.pending = [];
  }

  isBusy() {
    return this.activeId !== null || this.pending.length > 0;
  }

  getActiveId() {
    return this.activeId;
  }

  async enqueue(requestId, fn) {
    if (this.activeId === requestId) {
      return undefined;
    }

    if (this.activeId !== null) {
      const err = new Error('BUSY');
      err.code = 'BUSY';
      throw err;
    }

    this.activeId = requestId;
    try {
      return await fn();
    } finally {
      this.activeId = null;
      this.drain();
    }
  }

  drain() {
    if (this.activeId !== null || this.pending.length === 0) return;
    const next = this.pending.shift();
    this.enqueue(next.requestId, next.fn).then(next.resolve, next.reject);
  }

  rejectIfBusy(requestId) {
    if (this.activeId !== null && this.activeId !== requestId) {
      const err = new Error('BUSY');
      err.code = 'BUSY';
      throw err;
    }
  }
}

export const requestQueue = new RequestQueue(1);
