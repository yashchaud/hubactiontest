/**
 * Censorship Rules Service
 * Manages censorship rules, profanity lists, and configuration
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, '../config/censorshipRules.json');

class CensorshipRulesService {
  constructor() {
    this.rules = null;
    this.defaultRules = this._getDefaultRules();
    this._loadRules();
  }

  /**
   * Get default rules structure
   */
  _getDefaultRules() {
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      global: {
        enabled: true,
        frameSampleRate: 1,
        confidenceThresholds: {
          text: 0.7,
          nsfw: 0.85,
          audio: 0.8
        }
      },
      text: {
        enabled: true,
        profanityList: [
          // Common profanity (add your own list)
          'fuck',
          'shit',
          'damn',
          'ass',
          'bitch',
          'bastard'
        ],
        whitelist: [
          // Context-aware whitelist
          'Scunthorpe', // City name
          'assassin',   // Game/movie reference
        ],
        caseSensitive: false,
        detectInImages: true
      },
      nsfw: {
        enabled: true,
        categories: {
          EXPOSED_GENITALIA_F: {
            enabled: true,
            censorshipLevel: 'critical',
            blurMethod: 'black_box'
          },
          EXPOSED_GENITALIA_M: {
            enabled: true,
            censorshipLevel: 'critical',
            blurMethod: 'black_box'
          },
          EXPOSED_BREAST_F: {
            enabled: true,
            censorshipLevel: 'high',
            blurMethod: 'pixelate'
          },
          EXPOSED_BUTTOCKS: {
            enabled: true,
            censorshipLevel: 'high',
            blurMethod: 'blur'
          },
          EXPOSED_BREAST_M: {
            enabled: false,
            censorshipLevel: 'medium',
            blurMethod: 'blur'
          }
        }
      },
      audio: {
        enabled: true,
        profanityList: [
          'fuck',
          'shit',
          'damn',
          'ass',
          'bitch'
        ],
        bleepDuration: 500,
        transcriptionEnabled: true
      },
      tracking: {
        enabled: true,
        trackerType: 'CSRT',
        predictionFrames: 3,
        maxAge: 30
      },
      blur: {
        method: 'blur', // 'blur', 'pixelate', 'black_box'
        kernelSize: 51,
        sigma: 25,
        padding: 10,
        feathering: true
      },
      actions: {
        onCriticalDetection: {
          enabled: false,
          action: 'disconnect', // 'disconnect', 'alert', 'log'
          threshold: 3 // Number of critical detections before action
        },
        onHighDetection: {
          enabled: true,
          action: 'alert',
          threshold: 5
        },
        alertWebhook: null // URL to send alerts to
      },
      roomOverrides: {
        // Per-room custom rules
        // 'room-name': { ...custom rules... }
      }
    };
  }

  /**
   * Load rules from file
   */
  async _loadRules() {
    try {
      const data = await fs.readFile(CONFIG_PATH, 'utf-8');
      this.rules = JSON.parse(data);
      console.log('[CensorshipRules] Rules loaded from file');
    } catch (error) {
      console.log('[CensorshipRules] No rules file found, using defaults');
      this.rules = this.defaultRules;
      await this.saveRules();
    }
  }

  /**
   * Save rules to file
   */
  async saveRules() {
    try {
      // Ensure config directory exists
      const configDir = path.dirname(CONFIG_PATH);
      await fs.mkdir(configDir, { recursive: true });

      // Update last updated timestamp
      this.rules.lastUpdated = new Date().toISOString();

      // Write to file
      await fs.writeFile(
        CONFIG_PATH,
        JSON.stringify(this.rules, null, 2),
        'utf-8'
      );

      console.log('[CensorshipRules] Rules saved to file');
      return { success: true };
    } catch (error) {
      console.error('[CensorshipRules] Error saving rules:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all rules
   */
  getRules() {
    return { ...this.rules };
  }

  /**
   * Get rules for a specific room
   */
  getRoomRules(roomName) {
    const roomOverride = this.rules.roomOverrides?.[roomName];

    if (roomOverride) {
      // Merge room override with global rules
      return this._mergeRules(this.rules, roomOverride);
    }

    return { ...this.rules };
  }

  /**
   * Merge rules (deep merge)
   */
  _mergeRules(base, override) {
    const merged = { ...base };

    for (const key in override) {
      if (typeof override[key] === 'object' && !Array.isArray(override[key])) {
        merged[key] = this._mergeRules(merged[key] || {}, override[key]);
      } else {
        merged[key] = override[key];
      }
    }

    return merged;
  }

  /**
   * Update global rules
   */
  async updateGlobalRules(updates) {
    this.rules = this._mergeRules(this.rules, updates);
    return await this.saveRules();
  }

  /**
   * Update room-specific rules
   */
  async updateRoomRules(roomName, rules) {
    if (!this.rules.roomOverrides) {
      this.rules.roomOverrides = {};
    }

    this.rules.roomOverrides[roomName] = rules;
    return await this.saveRules();
  }

  /**
   * Delete room-specific rules
   */
  async deleteRoomRules(roomName) {
    if (this.rules.roomOverrides?.[roomName]) {
      delete this.rules.roomOverrides[roomName];
      return await this.saveRules();
    }

    return { success: true };
  }

  /**
   * Add word to profanity list
   */
  async addProfanityWord(word, type = 'text') {
    if (type === 'text') {
      if (!this.rules.text.profanityList.includes(word)) {
        this.rules.text.profanityList.push(word);
        await this.saveRules();
      }
    } else if (type === 'audio') {
      if (!this.rules.audio.profanityList.includes(word)) {
        this.rules.audio.profanityList.push(word);
        await this.saveRules();
      }
    }

    return { success: true };
  }

  /**
   * Remove word from profanity list
   */
  async removeProfanityWord(word, type = 'text') {
    if (type === 'text') {
      const index = this.rules.text.profanityList.indexOf(word);
      if (index > -1) {
        this.rules.text.profanityList.splice(index, 1);
        await this.saveRules();
      }
    } else if (type === 'audio') {
      const index = this.rules.audio.profanityList.indexOf(word);
      if (index > -1) {
        this.rules.audio.profanityList.splice(index, 1);
        await this.saveRules();
      }
    }

    return { success: true };
  }

  /**
   * Add word to whitelist
   */
  async addWhitelistWord(word) {
    if (!this.rules.text.whitelist.includes(word)) {
      this.rules.text.whitelist.push(word);
      await this.saveRules();
    }

    return { success: true };
  }

  /**
   * Get censorship config for RunPod service
   */
  getCensorshipConfig(roomName) {
    const rules = this.getRoomRules(roomName);

    return {
      enableTextDetection: rules.text?.enabled !== false,
      enableNSFWDetection: rules.nsfw?.enabled !== false,
      enableAudioProfanity: rules.audio?.enabled !== false,
      enableObjectTracking: rules.tracking?.enabled !== false,
      textConfidence: rules.global?.confidenceThresholds?.text || 0.7,
      nsfwConfidence: rules.global?.confidenceThresholds?.nsfw || 0.85,
      audioConfidence: rules.global?.confidenceThresholds?.audio || 0.8,
      profanityList: [
        ...(rules.text?.profanityList || []),
        ...(rules.audio?.profanityList || [])
      ],
      frameSampleRate: rules.global?.frameSampleRate || 1
    };
  }

  /**
   * Validate detection against rules
   */
  shouldCensor(detection, roomName) {
    const rules = this.getRoomRules(roomName);

    // Check if detection type is enabled
    if (detection.type === 'text' && !rules.text?.enabled) {
      return false;
    }

    if (detection.type === 'nsfw' && !rules.nsfw?.enabled) {
      return false;
    }

    // Check NSFW category rules
    if (detection.type === 'nsfw' && detection.label) {
      const categoryRule = rules.nsfw?.categories?.[detection.label];
      if (categoryRule && !categoryRule.enabled) {
        return false;
      }
    }

    // Check whitelist for text
    if (detection.type === 'text' && detection.text) {
      const whitelist = rules.text?.whitelist || [];
      for (const word of whitelist) {
        if (detection.text.toLowerCase().includes(word.toLowerCase())) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Reset to default rules
   */
  async resetToDefaults() {
    this.rules = this._getDefaultRules();
    return await this.saveRules();
  }

  /**
   * Export rules
   */
  exportRules() {
    return JSON.stringify(this.rules, null, 2);
  }

  /**
   * Import rules
   */
  async importRules(rulesJson) {
    try {
      const importedRules = JSON.parse(rulesJson);
      this.rules = importedRules;
      return await this.saveRules();
    } catch (error) {
      console.error('[CensorshipRules] Error importing rules:', error);
      return { success: false, error: error.message };
    }
  }
}

// Singleton instance
const censorshipRulesService = new CensorshipRulesService();

export default censorshipRulesService;
