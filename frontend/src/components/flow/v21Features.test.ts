import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { copyToClipboard } from '../../lib/clipboard';
import { applyThemeColor, getHexLuminance } from '../../lib/theme';
import {
  EXPERIMENTAL_NODE_TYPES,
  getNodeRetryConfig,
  isExperimentalNode,
  supportsContinueOnError,
} from './nodeDefinitions';
import { validateFlow } from './validation/flowValidation';

const makeNode = (id: string, type: string, data: Record<string, unknown> = {}): Node =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as Node;

const makeEdge = (source: string, target: string, sourceHandle?: string): Edge =>
  ({
    id: `${source}-${target}-${sourceHandle || 'default'}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
  }) as Edge;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function createMockDocument(execCopyImpl: () => boolean) {
  const appended: Array<Record<string, any>> = [];
  const removed: Array<Record<string, any>> = [];
  const setProperty = vi.fn();

  const mockBody = {
    appendChild: vi.fn((el: Record<string, any>) => {
      appended.push(el);
      return el;
    }),
    removeChild: vi.fn((el: Record<string, any>) => {
      removed.push(el);
      return el;
    }),
  };

  const mockDoc = {
    body: mockBody,
    documentElement: {
      style: { setProperty },
    },
    createElement: vi.fn((tag: string) => ({
      tagName: tag.toUpperCase(),
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    })),
    execCommand: vi.fn(execCopyImpl),
  };

  return { mockDoc, mockBody, appended, removed, setProperty };
}

describe('copyToClipboard', () => {
  it('uses navigator.clipboard.writeText when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const ok = await copyToClipboard('https://orquesta.local/webhook/abc');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://orquesta.local/webhook/abc');
  });

  it('falls back to textarea + execCommand when navigator.clipboard is missing', async () => {
    const { mockDoc, mockBody, appended, removed } = createMockDocument(() => true);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', mockDoc);

    const ok = await copyToClipboard('texto-lan-sin-https');

    expect(ok).toBe(true);
    expect(mockDoc.createElement).toHaveBeenCalledWith('textarea');
    expect(mockDoc.execCommand).toHaveBeenCalledWith('copy');
    expect(appended).toHaveLength(1);
    expect(appended[0].value).toBe('texto-lan-sin-https');
    expect(mockBody.removeChild).toHaveBeenCalledTimes(1);
    expect(removed).toEqual(appended);
  });

  it('falls back to execCommand when navigator.clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const { mockDoc, mockBody } = createMockDocument(() => true);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', mockDoc);

    const ok = await copyToClipboard('secret-fallback');

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(mockDoc.execCommand).toHaveBeenCalledWith('copy');
    expect(mockBody.removeChild).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it('returns false when both clipboard API and execCommand fallback fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Denied'));
    const { mockDoc, mockBody } = createMockDocument(() => {
      throw new Error('execCommand disabled');
    });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', mockDoc);

    await expect(copyToClipboard('fail-text')).resolves.toBe(false);
    expect(mockBody.removeChild).toHaveBeenCalledTimes(1);
  });
});

describe('theme --accent-on contrast', () => {
  it('computes perceptual luminance for 3- and 6-digit hex colors', () => {
    expect(getHexLuminance('#000000')).toBe(0);
    expect(getHexLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(getHexLuminance('#fff')).toBeCloseTo(1, 5);
    expect(getHexLuminance('#fde047')!).toBeGreaterThan(0.6);
    expect(getHexLuminance('#2f6feb')!).toBeLessThanOrEqual(0.6);
    expect(getHexLuminance('not-a-hex')).toBeNull();
  });

  it('sets dark text (--accent-on=#0f172a) for bright accents and white (#ffffff) for dark accents', () => {
    const { mockDoc, setProperty } = createMockDocument(() => true);
    vi.stubGlobal('document', mockDoc);

    applyThemeColor('#fde047');
    expect(setProperty).toHaveBeenCalledWith('--accent', '#fde047');
    expect(setProperty).toHaveBeenCalledWith('--border-focus', '#fde047');
    expect(setProperty).toHaveBeenCalledWith('--accent-on', '#0f172a');

    setProperty.mockClear();

    applyThemeColor('#2f6feb');
    expect(setProperty).toHaveBeenCalledWith('--accent', '#2f6feb');
    expect(setProperty).toHaveBeenCalledWith('--border-focus', '#2f6feb');
    expect(setProperty).toHaveBeenCalledWith('--accent-on', '#ffffff');
  });
});

describe('webhookTrigger, webhookRespond, and error_branch definitions', () => {
  it('excludes webhookTrigger and webhookRespond from EXPERIMENTAL_NODE_TYPES', () => {
    expect(EXPERIMENTAL_NODE_TYPES).not.toContain('webhookTrigger');
    expect(EXPERIMENTAL_NODE_TYPES).not.toContain('webhookRespond');
    expect(isExperimentalNode('webhookTrigger')).toBe(false);
    expect(isExperimentalNode('webhookRespond')).toBe(false);
    expect(isExperimentalNode('oauth2Connector')).toBe(true);
    expect(isExperimentalNode('aiChatCompletion')).toBe(true);
  });

  it('parses error_branch retry policy and supportsContinueOnError gates', () => {
    expect(getNodeRetryConfig({ onError: 'error_branch', retryCount: 2, retryDelayMs: 500, retryBackoff: 'fixed' })).toEqual({
      retryCount: 2,
      retryDelayMs: 500,
      retryBackoff: 'fixed',
      onError: 'error_branch',
    });
    expect(getNodeRetryConfig({ onError: 'continue' }).onError).toBe('continue');
    expect(getNodeRetryConfig({}).onError).toBe('stop');

    expect(supportsContinueOnError('httpRequest')).toBe(true);
    expect(supportsContinueOnError('webhookRespond')).toBe(true);
    expect(supportsContinueOnError('start')).toBe(false);
    expect(supportsContinueOnError('forEach')).toBe(false);
    expect(supportsContinueOnError('conditionalBranch')).toBe(false);
  });

  it('validates sync webhookRespond pairing and error_branch connectivity with $error templates', () => {
    const whSync = makeNode('wh1', 'webhookTrigger', { responseMode: 'sync', httpMethod: 'POST' });
    const httpNode = makeNode('http1', 'httpRequest', {
      endpoint: 'https://api.example.test/orders',
      onError: 'error_branch',
    });
    const respondOk = makeNode('respOk', 'webhookRespond', {
      statusCode: 200,
      body: '{"ok": true, "id": "{{http1.id}}"}',
    });
    const respondErr = makeNode('respErr', 'webhookRespond', {
      statusCode: 502,
      body: '{"ok": false, "error": "{{$error.message}}", "node": "{{$error.nodeId}}"}',
    });

    const brokenIssues = validateFlow([whSync, httpNode], [makeEdge('wh1', 'http1')]);
    expect(brokenIssues.some(i => i.nodeId === 'wh1' && i.level === 'warning')).toBe(true);
    expect(brokenIssues.some(i => i.nodeId === 'http1' && i.level === 'warning')).toBe(true);

    const wiredIssues = validateFlow(
      [whSync, httpNode, respondOk, respondErr],
      [
        makeEdge('wh1', 'http1'),
        makeEdge('http1', 'respOk'),
        makeEdge('http1', 'respErr', 'error'),
      ]
    );
    expect(wiredIssues).toEqual([]);
  });
});
