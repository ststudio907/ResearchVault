// tests/template.test.ts
//
// The `{{var}}` renderer has zero logic by design; these tests pin the
// contract so nobody "improves" it into something with conditional logic.
//
// KNOWN DOC/BEHAVIOR MISMATCH (flagged 2026-10, Phase 5): the module
// comment claims unknown `{{ keys }}` are left as-is, but the
// implementation replaces them with an empty string. These tests pin the
// *implemented* behavior; whichever side should win is a product decision
// for the user, not something to change quietly here.

import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../src/utils/template';

describe('renderTemplate', () => {
  it('replaces a plain key', () => {
    expect(renderTemplate('Hello {{name}}!', { name: 'world' })).toBe('Hello world!');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{  name  }}', { name: 'x' })).toBe('x');
  });

  it('replaces every occurrence of a repeated key', () => {
    expect(renderTemplate('{{a}} and {{a}}', { a: '1' })).toBe('1 and 1');
  });

  it('renders numbers and booleans as strings', () => {
    expect(renderTemplate('{{y}}-{{f}}', { y: 2023, f: false })).toBe('2023-false');
  });

  it('renders missing, empty-string, null, and undefined values as ""', () => {
    expect(renderTemplate('[{{missing}}]', {})).toBe('[]');
    expect(renderTemplate('[{{k}}]', { k: '' })).toBe('[]');
    expect(renderTemplate('[{{k}}]', { k: null })).toBe('[]');
    expect(renderTemplate('[{{k}}]', { k: undefined })).toBe('[]');
  });

  it('leaves tokens that are not valid keys alone', () => {
    // Key must start with a letter; `{{1st}}` and `{{}}` are untouched.
    expect(renderTemplate('{{1st}} {{}}', {})).toBe('{{1st}} {{}}');
  });

  it('returns the template unchanged when empty', () => {
    expect(renderTemplate('', { a: 'b' })).toBe('');
  });
});
