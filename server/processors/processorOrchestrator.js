/**
 * Processor Orchestrator - Manages multiple processors in parallel
 * Coordinates execution of pre/post processors and custom processors
 */

import { EventEmitter } from 'events';

class ProcessorOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.processors = new Map();
    this.processorOrder = [];
    this.executionStats = new Map();
  }

  /**
   * Register a processor
   * @param {string} name - Processor name
   * @param {object} processor - Processor instance
   * @param {object} options - Options (priority, enabled, runInParallel)
   */
  register(name, processor, options = {}) {
    const config = {
      name,
      processor,
      priority: options.priority || 100,
      enabled: options.enabled !== false,
      runInParallel: options.runInParallel !== false,
      condition: options.condition || null, // Function to determine if processor should run
      ...options
    };

    this.processors.set(name, config);
    this._sortProcessors();

    console.log(`[Orchestrator] Registered processor: ${name} (priority: ${config.priority})`);

    // Initialize stats
    this.executionStats.set(name, {
      executions: 0,
      totalTime: 0,
      averageTime: 0,
      errors: 0,
      lastExecution: null
    });

    return this;
  }

  /**
   * Unregister a processor
   */
  unregister(name) {
    if (this.processors.has(name)) {
      this.processors.delete(name);
      this.executionStats.delete(name);
      this._sortProcessors();
      console.log(`[Orchestrator] Unregistered processor: ${name}`);
    }
    return this;
  }

  /**
   * Enable/disable a processor
   */
  setEnabled(name, enabled) {
    const config = this.processors.get(name);
    if (config) {
      config.enabled = enabled;
      console.log(`[Orchestrator] ${name} ${enabled ? 'enabled' : 'disabled'}`);
    }
    return this;
  }

  /**
   * Sort processors by priority
   */
  _sortProcessors() {
    this.processorOrder = Array.from(this.processors.values())
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if processor should run
   */
  _shouldRun(config, context) {
    if (!config.enabled) {
      return false;
    }

    if (config.condition && typeof config.condition === 'function') {
      return config.condition(context);
    }

    return true;
  }

  /**
   * Execute a single processor
   */
  async _executeProcessor(config, method, args, context) {
    const startTime = Date.now();
    const { name, processor } = config;

    try {
      console.log(`[Orchestrator] Executing: ${name}.${method}`);

      // Check if method exists
      if (!processor[method] || typeof processor[method] !== 'function') {
        throw new Error(`Method ${method} not found in processor ${name}`);
      }

      // Execute processor method
      const result = await processor[method](...args);

      // Update stats
      const executionTime = Date.now() - startTime;
      this._updateStats(name, executionTime, true);

      this.emit('processor:executed', {
        name,
        method,
        executionTime,
        result
      });

      console.log(`[Orchestrator] ${name}.${method} completed in ${executionTime}ms`);

      return {
        name,
        success: true,
        result,
        executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this._updateStats(name, executionTime, false);

      this.emit('processor:error', {
        name,
        method,
        error: error.message,
        executionTime
      });

      console.error(`[Orchestrator] Error in ${name}.${method}:`, error);

      return {
        name,
        success: false,
        error: error.message,
        executionTime
      };
    }
  }

  /**
   * Update execution statistics
   */
  _updateStats(name, executionTime, success) {
    const stats = this.executionStats.get(name);
    if (stats) {
      stats.executions++;
      stats.totalTime += executionTime;
      stats.averageTime = stats.totalTime / stats.executions;
      stats.lastExecution = new Date();

      if (!success) {
        stats.errors++;
      }
    }
  }

  /**
   * Execute all processors for a specific method
   * @param {string} method - Method name to execute
   * @param {Array} args - Arguments to pass to processors
   * @param {object} context - Execution context
   * @param {object} options - Execution options
   */
  async executeAll(method, args = [], context = {}, options = {}) {
    const {
      stopOnError = false,
      mergeResults = true,
      parallel = true
    } = options;

    console.log(`[Orchestrator] Executing all processors: ${method}`);
    const startTime = Date.now();

    // Filter processors that should run
    const runnableProcessors = this.processorOrder.filter(config =>
      this._shouldRun(config, context)
    );

    if (runnableProcessors.length === 0) {
      console.log(`[Orchestrator] No processors to run for ${method}`);
      return {
        success: true,
        results: [],
        totalTime: 0
      };
    }

    // Group by parallel execution capability
    const parallelProcessors = runnableProcessors.filter(c => c.runInParallel);
    const sequentialProcessors = runnableProcessors.filter(c => !c.runInParallel);

    const allResults = [];

    try {
      // Execute parallel processors first
      if (parallelProcessors.length > 0 && parallel) {
        console.log(`[Orchestrator] Executing ${parallelProcessors.length} processors in parallel`);

        const parallelPromises = parallelProcessors.map(config =>
          this._executeProcessor(config, method, args, context)
        );

        const parallelResults = await Promise.all(parallelPromises);
        allResults.push(...parallelResults);

        // Check for errors if stopOnError is true
        if (stopOnError) {
          const hasError = parallelResults.some(r => !r.success);
          if (hasError) {
            const totalTime = Date.now() - startTime;
            return {
              success: false,
              results: allResults,
              totalTime,
              error: 'Parallel execution failed'
            };
          }
        }
      }

      // Execute sequential processors
      if (sequentialProcessors.length > 0) {
        console.log(`[Orchestrator] Executing ${sequentialProcessors.length} processors sequentially`);

        for (const config of sequentialProcessors) {
          const result = await this._executeProcessor(config, method, args, context);
          allResults.push(result);

          // Stop on error if configured
          if (stopOnError && !result.success) {
            const totalTime = Date.now() - startTime;
            return {
              success: false,
              results: allResults,
              totalTime,
              error: `Sequential execution failed at ${result.name}`
            };
          }
        }
      }

      const totalTime = Date.now() - startTime;

      console.log(
        `[Orchestrator] Completed ${allResults.length} processors in ${totalTime}ms`
      );

      // Merge results if requested
      let finalResult;
      if (mergeResults) {
        finalResult = this._mergeResults(allResults);
      } else {
        finalResult = allResults;
      }

      return {
        success: true,
        results: finalResult,
        totalTime,
        processorsRun: allResults.length
      };

    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error(`[Orchestrator] Fatal error during execution:`, error);

      return {
        success: false,
        results: allResults,
        totalTime,
        error: error.message
      };
    }
  }

  /**
   * Merge results from multiple processors
   */
  _mergeResults(results) {
    const merged = {
      success: results.every(r => r.success),
      processors: results.map(r => ({
        name: r.name,
        success: r.success,
        executionTime: r.executionTime
      })),
      data: {}
    };

    // Merge result data
    for (const result of results) {
      if (result.success && result.result) {
        merged.data[result.name] = result.result;
      }
    }

    return merged;
  }

  /**
   * Execute specific processors by name
   */
  async executeSelected(processorNames, method, args = [], context = {}) {
    console.log(`[Orchestrator] Executing selected processors: ${processorNames.join(', ')}`);

    const promises = processorNames.map(name => {
      const config = this.processors.get(name);
      if (!config) {
        throw new Error(`Processor ${name} not found`);
      }

      if (!this._shouldRun(config, context)) {
        return Promise.resolve({
          name,
          success: false,
          skipped: true,
          reason: 'Condition not met or disabled'
        });
      }

      return this._executeProcessor(config, method, args, context);
    });

    const results = await Promise.all(promises);

    return {
      success: results.every(r => r.success || r.skipped),
      results
    };
  }

  /**
   * Get orchestrator statistics
   */
  getStats() {
    const stats = {};

    for (const [name, stat] of this.executionStats.entries()) {
      stats[name] = { ...stat };
    }

    return {
      processors: Array.from(this.processors.keys()),
      executionStats: stats,
      totalProcessors: this.processors.size,
      enabledProcessors: Array.from(this.processors.values()).filter(c => c.enabled).length
    };
  }

  /**
   * Get list of registered processors
   */
  getProcessors() {
    return Array.from(this.processors.entries()).map(([name, config]) => ({
      name,
      priority: config.priority,
      enabled: config.enabled,
      runInParallel: config.runInParallel,
      hasCondition: !!config.condition
    }));
  }

  /**
   * Reset statistics
   */
  resetStats() {
    for (const stats of this.executionStats.values()) {
      stats.executions = 0;
      stats.totalTime = 0;
      stats.averageTime = 0;
      stats.errors = 0;
      stats.lastExecution = null;
    }

    console.log('[Orchestrator] Statistics reset');
  }

  /**
   * Clear all processors
   */
  clear() {
    this.processors.clear();
    this.processorOrder = [];
    this.executionStats.clear();
    console.log('[Orchestrator] All processors cleared');
  }
}

// Singleton instance
const processorOrchestrator = new ProcessorOrchestrator();

export default processorOrchestrator;
