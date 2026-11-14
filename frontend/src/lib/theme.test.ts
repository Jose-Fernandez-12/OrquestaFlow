import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyThemeColor, getHexLuminance } from './theme';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getHexLuminance', () => {
  it('calculates perceived luminance for 3-digit and 6-digit hex colors', () => {
    expect(getHexLuminance('#000000')).toBe(0);
    expect(getHexLuminance('#ffffff')).toBe(1);
    expect(getHexLuminance(' #fff ')).toBe(1);
    expect(getHexLuminance('#000')).toBe(0);

    const blue = getHexLuminance('#2f6feb');
    const yellow = getHexLuminance('#facc15');
    expect(blue).not.toBeNull();
    expect(yellow).not.toBeNull();
    expect(blue!).toBeLessThan(0.6);
    expect(yellow!).toBeGreaterThan(0.6);
  });

  it('returns null for invalid hex strings', () => {
    expect(getHexLuminance('')).toBeNull();
    expect(getHexLuminance('#12')).toBeNull();
    expect(getHexLuminance('#12345')).toBeNull();
    expect(getHexLuminance('rgb(0,0,0)')).toBeNull();
  });
});

describe('applyThemeColor', () => {
  it('sets --accent, --border-focus, and high-contrast --accent-on based on luminance', () => {
    const props = new Map<string, string>();
    vi.stubGlobal('document', {
      documentElement: {
        style: {
          setProperty: (key: string, value: string) => {
            props.set(key, value);
          },
        },
      },
    });

    applyThemeColor('#2f6feb');
    expect(props.get('--accent')).toBe('#2f6feb');
    expect(props.get('--border-focus')).toBe('#2f6feb');
    expect(props.get('--accent-on')).toBe('#ffffff');

    applyThemeColor('#facc15');
    expect(props.get('--accent')).toBe('#facc15');
    expect(props.get('--border-focus')).toBe('#facc15');
    expect(props.get('--accent-on')).toBe('#0f172a');
  });

  it('does nothing when accentHex is empty or document is unavailable', () => {
    const setProperty = vi.fn();
    vi.stubGlobal('document', {
      documentElement: { style: { setProperty } },
    });

    applyThemeColor('');
    expect(setProperty).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    expect(() => applyThemeColor('#2f6feb')).not.toThrow();
  });
});
