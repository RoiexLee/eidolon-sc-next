"use client";

import { lazy, Suspense, useEffect, useRef } from "react";

import type { Outfit } from "@/lib/api";

// 立绘（spine-ts 和应用的立绘组件）不进首屏的包：要挂的时候才加载。
const Stand = lazy(() => import("@/components/conversations/stand/Stand").then((m) => ({ default: m.Stand })));

/** 立绘画布的像素比上限（spec「渲染层」）。 */
const STAND_DPR = 1.5;
/** 立绘的待机姿势：不说话，看着镜头；招呼的声音在播时开口。 */
const LOOKING = { mood: "calm", speaking: false, looking: true, nod: null } as const;
const SPEAKING = { ...LOOKING, speaking: true } as const;

/**
 * 她的立绘（第 2 幕聚焦时、第 4 幕来电时）：复用应用的立绘组件（独立 canvas，只盖立绘区域），穿默认衣装。素材加载不到时画布一直是空的，
 * 只剩名字和光，不报错。手机上离开她就释放 WebGL 上下文（立绘组件自己不释放，见 StandEngine.dispose）：
 * 卸下以后画布已经不在页面上了才释放，React 开发模式下 effect 重跑时画布还在，不会误伤。
 */
export function StandSlot({
  outfit,
  still,
  speaking,
  framing = "knees",
  paused = false,
}: {
  outfit: Outfit;
  still: boolean;
  speaking: boolean;
  /** 先挂上、不画：第 4 幕手机屏幕上的立绘在来电时就加载好，接通了才画，挂断就停。 */
  paused?: boolean;
  /** 取景：光谱里到膝盖，第 4 幕的来电到腰。 */
  framing?: "knees" | "waist";
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    return () => {
      const canvas = el?.querySelector("canvas");
      if (!canvas || !matchMedia("(hover: none)").matches) return;
      window.setTimeout(() => {
        if (canvas.isConnected) return;
        (canvas.getContext("webgl2") ?? canvas.getContext("webgl"))?.getExtension("WEBGL_lose_context")?.loseContext();
      }, 0);
    };
  }, []);
  return (
    <div ref={box} className="lp-stand-canvas">
      <Suspense fallback={null}>
        <Stand
          outfits={[outfit]}
          framing={framing}
          // 落地页是 SC 专属的视觉世界（ADR-0016），format 先写死；多作品落地页时从 character 数据带进来。
          format="spine-3.6"
          isPaused={paused}
          entrance={still ? "fade" : "rise"}
          direction={speaking ? SPEAKING : LOOKING}
          isReducedMotion={still}
          isStill={still}
          maxPixelRatio={STAND_DPR}
        />
      </Suspense>
    </div>
  );
}
