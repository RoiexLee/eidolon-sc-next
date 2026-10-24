// 分发点（spec「渲染」、plan-pjsk-01）：格式决定引擎。Spine 引擎能真的构造出来（假件只补
// 构造函数碰到的面）；还没有引擎的格式一律拒载。

import { describe, expect, test, vi } from "vitest";

import { SpineStandEngine } from "./SpineStandEngine";
import { createStandEngine, StandUnavailable } from "./standEngine";
import { loadSpineRuntime } from "./spineRuntime";

vi.mock("./spineRuntime", () => ({ loadSpineRuntime: vi.fn() }));

const fakeSpine = {
  webgl: {
    ManagedWebGLRenderingContext: class {
      gl = { pixelStorei() {}, isContextLost: () => false };
    },
    SceneRenderer: class {
      camera = { position: { x: 0, y: 0 }, setViewport() {} };
      begin() {}
      drawSkeleton() {}
      end() {}
      dispose() {}
    },
    AssetManager: class {
      assets = {};
      loadText() {}
      loadTextureAtlas() {}
      get() {
        return null;
      }
      dispose() {}
    },
  },
} as never;

const fakeCanvas = { addEventListener() {} } as unknown as HTMLCanvasElement;

describe("createStandEngine", () => {
  test("spine-3.6 builds the Spine engine", async () => {
    vi.mocked(loadSpineRuntime).mockResolvedValue(fakeSpine);

    await expect(createStandEngine(fakeCanvas, "spine-3.6", "waist")).resolves.toBeInstanceOf(SpineStandEngine);
  });

  test("formats without an engine yet do not build one", async () => {
    // live2d-cubism4 在它的引擎落地（plan-pjsk-02）前，与未知格式一样画不了。
    for (const format of ["live2d-cubism4", "mmd"] as never[]) {
      await expect(createStandEngine(fakeCanvas, format, "waist"), `format=${format}`).rejects.toBeInstanceOf(
        StandUnavailable,
      );
    }
  });
});
