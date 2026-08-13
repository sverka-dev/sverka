import { parseCpu, parseMemory } from "./parse.js";

/**
 * Internal resource pool. Tracks available CPU (fractional) and memory
 * (bytes). Only used by the scheduler when `totalCpu`/`totalMemory` are
 * configured. Not part of the public surface.
 */
export class ResourcePool {
  private availableCpu: number;
  private availableMemory: number;

  constructor(totalCpu: number, totalMemory: number) {
    this.availableCpu = totalCpu;
    this.availableMemory = totalMemory;
  }

  /** Current available CPU (fractional units). */
  get cpu(): number {
    return this.availableCpu;
  }

  /** Current available memory (bytes). */
  get memory(): number {
    return this.availableMemory;
  }

  /**
   * Try to acquire `cpu` and `memory` for an operation. Returns true on
   * success (reserves the resources), false if insufficient.
   */
  tryAcquire(cpu: number, memory: number): boolean {
    if (cpu > this.availableCpu || memory > this.availableMemory) {
      return false;
    }
    this.availableCpu -= cpu;
    this.availableMemory -= memory;
    return true;
  }

  /** Release previously-acquired resources back to the pool. */
  release(cpu: number, memory: number): void {
    this.availableCpu += cpu;
    this.availableMemory += memory;
  }

  /** Build a pool from string config values. */
  static fromConfig(totalCpu: string, totalMemory: string): ResourcePool {
    return new ResourcePool(parseCpu(totalCpu), parseMemory(totalMemory));
  }
}
