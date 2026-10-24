/**
 * 衣装的缩略图（docs/deploy.md「立绘素材」）：给 `eidolon stand outfits` 写进整理目录的衣装清单里的每套衣装，
 * 渲染一张半身图，写到整理目录的 `thumbnails/<stand 或 stand_costume>/<enzaId>.png`。
 *
 * 用和通话层同一套播放代码：在无界面的 Chromium 里载入 `SpineStandEngine.ts`（现场转成 JavaScript，不打包）和
 * vendor 目录里的 spine runtime，按电脑「半身 ADV」的取景画平静的待机，让动画先走约 1 秒，避开待机表情开头的眨眼，
 * 再把画布截成透明背景的 PNG。已经有缩略图的衣装不再渲染（加 `--force` 全部重画），所以再次同步时缩略图不变，也不会重新上传。
 *
 *   node scripts/stand-thumbnails.mts [--build <整理目录>] [--force]
 *
 * 整理目录默认取环境变量 EIDOLON_STAND_BUILD_PATH（没有时是 ../corpus/stand），衣装的文件从它的 `source/` 读
 * （`eidolon stand fetch` 拉取到那里）。
 * 需要 Playwright 的 Chromium（`npx playwright install --with-deps chromium`）。退出码：0 成功；1 缺设置或没有衣装清单；
 * 2 有衣装渲染失败，其余照常写出；3 打不开 Chromium，或者渲染用的页面出错，一张都没渲染。
 */
import { createServer, type Server } from "node:http";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";

import { chromium, type Browser } from "playwright";
import ts from "typescript";

/** 缩略图的大小（CSS 像素）；按 2 倍像素比渲染，和手机上看到的一样清楚。 */
const SIZE = { width: 200, height: 250 };
const PIXEL_RATIO = 2;
/** 载入后让动画走多久再截图（毫秒）。 */
const SETTLE_MS = 1000;
/** 同时渲染几套。 */
const CONCURRENT_RENDERS = 4;
const RENDER_TIMEOUT_MS = 30_000;

const frontend = path.resolve(import.meta.dirname, "..");

const { values: args } = parseArgs({
  options: {
    build: { type: "string" },
    force: { type: "boolean", default: false },
  },
});
const build = path.resolve(args.build ?? process.env.EIDOLON_STAND_BUILD_PATH ?? "../corpus/stand");

async function main(): Promise<number> {
  const outfits = await listedOutfits(build);
  if (outfits === null) {
    console.error(`整理目录 ${path.join(build, "outfits")} 里没有衣装清单，先运行 eidolon stand outfits`);
    return 1;
  }
  const pending: string[] = [];
  for (const outfit of outfits) if (args.force || !(await exists(thumbnailOf(outfit)))) pending.push(outfit);
  console.log(`衣装清单里有 ${outfits.length} 套衣装，要渲染 ${pending.length} 套缩略图`);
  if (pending.length === 0) return 0;

  let browser: Browser;
  try {
    browser = await chromium.launch({
      // 用 SwiftShader 画 WebGL，没有显卡的服务器上也一样；新版 Chromium 要明确允许。
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
    });
  } catch (error) {
    console.error(`打不开 Playwright 的 Chromium（先运行 npx playwright install --with-deps chromium）：${messageOf(error)}`);
    return 3;
  }
  const server = await serve(path.join(build, "source"));
  const failed: string[] = [];
  const started = Date.now();
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENT_RENDERS, pending.length) }, async () => {
        const page = await openPage(browser, origin);
        while (next < pending.length) {
          const outfit = pending[next++];
          try {
            await render(page, outfit);
          } catch (error) {
            failed.push(outfit);
            console.error(`${outfit} 渲染失败：${messageOf(error)}`);
          }
        }
        await page.close();
      }),
    );
  } finally {
    await browser.close();
    server.close();
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`渲染了 ${pending.length - failed.length} 套缩略图，用时 ${seconds} 秒`);
  if (failed.length > 0) {
    console.error(`${failed.length} 套渲染失败，下次同步再试：${failed.join("、")}`);
    return 2;
  }
  return 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 整理目录里所有衣装清单列出的衣装，例如 `stand/1030010010`。 */
async function listedOutfits(directory: string): Promise<string[] | null> {
  const lists = path.join(directory, "outfits");
  let names: string[];
  try {
    names = (await readdir(lists)).filter((name) => name.endsWith(".json"));
  } catch {
    names = [];
  }
  if (names.length === 0) return null;
  const found = new Set<string>();
  for (const name of names) {
    const list = JSON.parse(await readFile(path.join(lists, name), "utf8")) as OutfitList;
    for (const card of list.cards) for (const outfit of [card.everyday, card.stage]) if (outfit) found.add(outfit.id);
  }
  return [...found].sort();
}

type OutfitList = { cards: { everyday: { id: string } | null; stage: { id: string } | null }[] };

function thumbnailOf(outfit: string): string {
  return path.join(build, "thumbnails", `${outfit}.png`);
}

async function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

/**
 * 只给这台机器上的浏览器用的服务器：`/` 是渲染用的页面，`/src/...` 是现场转成 JavaScript 的前端源码，
 * `/vendor/...` 是 spine runtime，`/assets/...` 是拉取到的衣装文件。
 */
async function serve(sourceRoot: string): Promise<Server> {
  const roots: Record<string, string> = {
    "/src/": path.join(frontend, "src"),
    "/vendor/": path.join(frontend, "public", "vendor"),
    "/assets/": path.join(sourceRoot, "assets"),
  };
  const server = createServer(async (request, response) => {
    const url = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    if (url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
      return;
    }
    const prefix = Object.keys(roots).find((p) => url.startsWith(p));
    const file = prefix && path.join(roots[prefix], url.slice(prefix.length));
    if (!prefix || !file || !file.startsWith(roots[prefix] + path.sep)) {
      response.writeHead(404).end();
      return;
    }
    try {
      if (prefix === "/src/") {
        // 源码里的 import 不带扩展名（`@/lib/standAnimations`），这里补上 `.ts`。
        const source = await readFile(file.endsWith(".ts") ? file : `${file}.ts`, "utf8");
        const { outputText } = ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        });
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }).end(outputText);
        return;
      }
      // 先读文件再写响应头：文件缺失时在上面抛出，由下面的 catch 回 404，不会把响应头写两次
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

const CONTENT_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".atlas": "text/plain; charset=utf-8",
  ".png": "image/png",
};

/** 渲染用的页面：一块画布和一个立绘引擎，`renderOutfit(id)` 换上这套衣装，走约 1 秒后返回。 */
const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<script type="importmap">{"imports": {"@/": "/src/"}}</script>
<script src="/vendor/spine-3.6/spine-webgl.js"></script>
<style>html, body { margin: 0; background: transparent; } canvas { display: block; width: ${SIZE.width}px; height: ${SIZE.height}px; }</style>
</head>
<body>
<canvas></canvas>
<script type="module">
import { SpineStandEngine } from "/src/components/conversations/stand/SpineStandEngine";
const canvas = document.querySelector("canvas");
let engine = null;
window.renderOutfit = async (id) => {
  // 同一块画布上换一个引擎，拿到的还是同一个 WebGL 上下文，不会越开越多。
  engine?.dispose();
  engine = new SpineStandEngine(canvas, window.spine, "waist");
  await engine.load({ id, url: "/assets/spine/idols/" + id + "/" });
  await new Promise((resolve) => setTimeout(resolve, ${SETTLE_MS}));
};
window.standReady = true;
</script>
</body>
</html>`;

async function openPage(browser: Browser, origin: string) {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: PIXEL_RATIO });
  page.setDefaultTimeout(RENDER_TIMEOUT_MS);
  page.on("pageerror", (error) => console.error(`页面出错：${error.message}`));
  await page.goto(origin);
  await page.waitForFunction(() => (window as { standReady?: boolean }).standReady === true);
  return page;
}

async function render(page: Awaited<ReturnType<typeof openPage>>, outfit: string): Promise<void> {
  await page.evaluate(
    (id) => (window as unknown as { renderOutfit: (id: string) => Promise<void> }).renderOutfit(id),
    outfit,
  );
  const png = await page.locator("canvas").screenshot({ omitBackground: true, type: "png" });
  const target = thumbnailOf(outfit);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(`${target}.part`, png);
  await rename(`${target}.part`, target);
}

try {
  process.exitCode = await main();
} catch (error) {
  // 例如渲染用的页面打不开：说清楚原因，不留一大段堆栈
  console.error(`渲染缩略图出错：${messageOf(error)}`);
  process.exitCode = 3;
}
