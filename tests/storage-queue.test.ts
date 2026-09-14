import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetDefaults, setEnabled } from '../utils/storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('storage mutation queue', () => {
  it('does not let a delayed mutation overwrite a later reset', async () => {
    let releaseGet!: () => void;
    const getGate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    let storedConfig = {
      params: { custom: { action: 'remove' as const } },
      enabled: true,
      globalMode: 'remove' as const,
      globalRewriteValue: 'custom',
    };
    let getStarted = false;

    vi.stubGlobal('browser', {
      storage: {
        sync: {
          get: vi.fn(async () => {
            getStarted = true;
            const snapshot = structuredClone(storedConfig);
            await getGate;
            return { config: snapshot };
          }),
          set: vi.fn(async ({ config }) => {
            storedConfig = structuredClone(config);
          }),
        },
      },
    });

    const mutation = setEnabled(false);
    await vi.waitFor(() => expect(getStarted).toBe(true));
    const reset = resetDefaults();
    releaseGet();
    await Promise.all([mutation, reset]);

    expect(storedConfig.enabled).toBe(true);
    expect(storedConfig.globalMode).toBe('rewrite');
    expect(storedConfig.globalRewriteValue).toBe('donttrackme');
    expect(storedConfig.params).not.toHaveProperty('custom');
  });
});
