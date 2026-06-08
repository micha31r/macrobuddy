import { describe, expect, it } from 'vitest';
import { parseCombo } from '../actions/hotkey.js';

describe('parseCombo', () => {
  it('maps cmd to ⌘ on macOS', () => {
    expect(parseCombo('cmd+shift+t', 'darwin')).toEqual({ key: 't', modifiers: ['cmd', 'shift'] });
  });

  it('maps cmd to control on Windows (spec: cmd→ctrl)', () => {
    expect(parseCombo('cmd+shift+t', 'win32')).toEqual({ key: 't', modifiers: ['control', 'shift'] });
  });

  it('supports modifier aliases', () => {
    expect(parseCombo('command+option+esc', 'darwin')).toEqual({ key: 'escape', modifiers: ['cmd', 'alt'] });
    expect(parseCombo('super+alt+f4', 'linux')).toEqual({ key: 'f4', modifiers: ['control', 'alt'] });
    expect(parseCombo('ctrl+opt+a', 'darwin')).toEqual({ key: 'a', modifiers: ['control', 'alt'] });
  });

  it('maps digits, F-keys and punctuation', () => {
    expect(parseCombo('ctrl+1', 'win32')).toEqual({ key: '1', modifiers: ['control'] });
    expect(parseCombo('f5', 'win32')).toEqual({ key: 'f5', modifiers: [] });
    expect(parseCombo('cmd+comma', 'darwin')).toEqual({ key: ',', modifiers: ['cmd'] });
  });

  it('maps named keys', () => {
    expect(parseCombo('enter', 'darwin')).toEqual({ key: 'return', modifiers: [] }); // main Enter, not numpad
    expect(parseCombo('cmd+backspace', 'darwin')).toEqual({ key: 'backspace', modifiers: ['cmd'] });
    expect(parseCombo('shift+space', 'darwin')).toEqual({ key: 'space', modifiers: ['shift'] });
  });

  it('maps media keys', () => {
    expect(parseCombo('playpause', 'darwin')).toEqual({ key: 'audio_play', modifiers: [] });
    expect(parseCombo('volumeup', 'win32')).toEqual({ key: 'audio_vol_up', modifiers: [] });
  });

  it('allows a lone modifier as the key', () => {
    expect(parseCombo('cmd', 'darwin')).toEqual({ key: 'cmd', modifiers: [] });
  });

  it('is whitespace- and case-insensitive', () => {
    expect(parseCombo(' CMD + Shift + T ', 'darwin')).toEqual({ key: 't', modifiers: ['cmd', 'shift'] });
  });

  it('rejects unknown keys with a descriptive error', () => {
    expect(() => parseCombo('cmd+banana', 'darwin')).toThrow(/unknown key "banana"/);
  });

  it('rejects non-modifiers before the final key', () => {
    expect(() => parseCombo('a+b', 'darwin')).toThrow(/"a" in combo "a\+b" is not a modifier/);
  });

  it('rejects empty combos', () => {
    expect(() => parseCombo(' + ', 'darwin')).toThrow(/empty hotkey combo/);
  });
});
