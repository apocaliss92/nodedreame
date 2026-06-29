import { describe, it, expect } from 'vitest';
import {
  AI_FEATURE_BIT,
  AI_FEATURE_JSON_KEY,
  decodeAiFeature,
  encodeAiFeatureWrite,
} from '../../../src/models/vacuum/ai-detection.js';

describe('AI obstacle-detection bitmask / JSON codec (Tasshack v2.0.0b25 parity)', () => {
  describe('decode — INT bitmask encoding (DreameVacuumAIProperty)', () => {
    // Live r2538z snapshot: furniture(1)+obstacle(2)+obstaclePicture(4)+fluid(8)
    // +fuzzy(256) ON, pet(16)+obstacleImageUpload(32) OFF → 1+2+4+8+256 = 271.
    const raw = 271;

    it('reads each feature bit out of the packed int', () => {
      expect(decodeAiFeature(raw, 'furnitureDetection')).toBe(true);
      expect(decodeAiFeature(raw, 'obstacleDetection')).toBe(true);
      expect(decodeAiFeature(raw, 'obstaclePicture')).toBe(true);
      expect(decodeAiFeature(raw, 'fluidDetection')).toBe(true);
      expect(decodeAiFeature(raw, 'fuzzyObstacleDetection')).toBe(true);
      expect(decodeAiFeature(raw, 'petDetection')).toBe(false);
      expect(decodeAiFeature(raw, 'obstacleImageUpload')).toBe(false);
    });
  });

  describe('decode — JSON string encoding (DreameVacuumStrAIProperty)', () => {
    const raw = JSON.stringify({
      obstacle_detect_switch: true,
      whether_have_pet: false,
      fluid_detect_switch: 1,
      furniture_detect_switch: 0,
    });

    it('reads each feature from its JSON key (coercing 1/0 → bool)', () => {
      expect(decodeAiFeature(raw, 'obstacleDetection')).toBe(true);
      expect(decodeAiFeature(raw, 'petDetection')).toBe(false);
      expect(decodeAiFeature(raw, 'fluidDetection')).toBe(true);
      expect(decodeAiFeature(raw, 'furnitureDetection')).toBe(false);
    });

    it('returns null for a key absent from the JSON payload', () => {
      expect(decodeAiFeature(raw, 'fuzzyObstacleDetection')).toBeNull();
    });
  });

  it('decode returns null for an unknown raw value or unmapped feature', () => {
    expect(decodeAiFeature(null, 'petDetection')).toBeNull();
    // fuzzyObstacleDetection has a bit but no JSON key.
    expect(decodeAiFeature('{}', 'fuzzyObstacleDetection')).toBeNull();
  });

  describe('encode — INT: read-modify-write preserves the other bits', () => {
    const raw = 271; // furniture+obstacle+obstaclePicture+fluid+fuzzy ON

    it('SET a bit ORs it in, leaving the rest intact', () => {
      // turn pet (16) ON → 271 | 16 = 287
      expect(encodeAiFeatureWrite(raw, 'petDetection', true)).toBe(287);
    });

    it('CLEAR a bit masks only that bit out', () => {
      // turn obstacle (2) OFF → 271 & ~2 = 269
      expect(encodeAiFeatureWrite(raw, 'obstacleDetection', false)).toBe(269);
    });

    it('SET an already-set bit is a no-op on the value', () => {
      expect(encodeAiFeatureWrite(raw, 'fluidDetection', true)).toBe(271);
    });
  });

  describe('encode — JSON: emits only the changed key (Tasshack set_ai_detection)', () => {
    const raw = JSON.stringify({ obstacle_detect_switch: true, whether_have_pet: false });

    it('returns a single-key JSON object for the toggled feature', () => {
      expect(encodeAiFeatureWrite(raw, 'petDetection', true)).toBe('{"whether_have_pet":true}');
    });
  });

  it('encode throws when the raw value/encoding is unknown', () => {
    expect(() => encodeAiFeatureWrite(null, 'petDetection', true)).toThrow();
  });

  it('the bit / json-key maps match Tasshack DreameVacuumAIProperty + StrAIProperty', () => {
    expect(AI_FEATURE_BIT.furnitureDetection).toBe(1);
    expect(AI_FEATURE_BIT.petDetection).toBe(16);
    expect(AI_FEATURE_BIT.fuzzyObstacleDetection).toBe(256);
    expect(AI_FEATURE_JSON_KEY.petDetection).toBe('whether_have_pet');
    expect(AI_FEATURE_JSON_KEY.obstacleDetection).toBe('obstacle_detect_switch');
  });
});
