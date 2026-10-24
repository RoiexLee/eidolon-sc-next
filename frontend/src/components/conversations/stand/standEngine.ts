// 立绘引擎的公开面与分发点（spec「渲染」、plan-pjsk-01）：立绘用哪套引擎由内容声明
// （characters.toml 的 stand_format，随角色 API 下发），这里按它选。各引擎实现本接口；
// `Framing` 与 `StandUnavailable` 对两套引擎都是公共的，住在这里。

import type { Outfit } from "@/lib/api";
import type { StandDirection } from "@/lib/standAnimations";

import { SpineStandEngine } from "./SpineStandEngine";
import { loadSpineRuntime } from "./spineRuntime";

/** 立绘用哪套引擎渲染：`spine-3.6` 是 SC 立绘（默认），`live2d-cubism4` 是 Live2D 模型。 */
export type StandFormat = "spine-3.6" | "live2d-cubism4";

/** 取景（spec「渲染」）：手机「大立绘」贴着头顶、到膝；电脑「半身 ADV」贴着头顶、到腰；换衣装的大预览是全身。 */
export type Framing = "knees" | "waist" | "full";

/** 这台设备上画不了立绘。 */
export class StandUnavailable extends Error {}

/** 立绘引擎的公开面（spec「立绘指令」「渲染」）：与 Spine 实现今天的公开面逐字一致。 */
export interface StandEngine {
  /** 取景可以随时改，下一帧起按新的取景画。 */
  framing: Framing;
  /** 载入一套衣装并画出来；已经穿着另一套时，换上这一套并释放上一套的素材。 */
  load(outfit: Outfit): Promise<void>;
  /** 按立绘指令摆姿势。立绘还没到时先记下，到了直接按最新的指令开始画。 */
  direct(direction: StandDirection, reducedMotion: boolean): void;
  /** 静帧：画出一帧就停（落地页的「减少动态效果」档）。 */
  setStill(still: boolean): void;
  /** 暂停（通话层收起时）不画，恢复后从当前姿势接着画。 */
  setPaused(paused: boolean): void;
  /** 停止绘制并释放素材。 */
  dispose(): void;
}

/**
 * 唯一的分发点：按格式懒加载对应的 runtime 再构造引擎。`live2d-cubism4` 在它的引擎落地
 * （plan-pjsk-02）之前与未知格式一样抛 `StandUnavailable`。
 */
export async function createStandEngine(
  canvas: HTMLCanvasElement,
  format: StandFormat,
  framing: Framing,
  maxPixelRatio?: number,
): Promise<StandEngine> {
  if (format === "spine-3.6") {
    const spine = await loadSpineRuntime();
    return new SpineStandEngine(canvas, spine, framing, maxPixelRatio);
  }
  throw new StandUnavailable(`立绘格式 ${format} 现在还画不了`);
}
