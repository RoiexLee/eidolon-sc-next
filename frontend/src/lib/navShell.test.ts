import { describe, expect, it } from "vitest";

import {
  currentNavItem,
  departure,
  isGiftsSubpageInView,
  isInShell,
  isTyping,
  navDestination,
  navDots,
  showsShellCallBar,
} from "@/lib/navShell";

describe("在不在导航外壳里", () => {
  it.each([
    "/conversations",
    "/conversation/mano",
    "/conversation/mano?x=1",
    "/conversation/group/g1",
    "/settings",
    "/settings?tab=own-keys",
    "/settings/own-keys",
    "/play",
    "/play/gifts",
    "/play/gifts?to=mano",
    "/play/tasks",
  ])("%s 在外壳里", (href) => {
    expect(isInShell(href)).toBe(true);
  });

  it.each([
    "/",
    "/about",
    "/privacy",
    "/terms",
    "/admin",
    "/admin/users/1",
    "/login",
    "/consent",
    "/conversation",
    "/conversations-old",
    "/settingsx",
    "/gifts",
    "/gifts?to=mano",
    "/gifts/cake",
    "/player",
    "/play/xxx",
    "/api/auth/link/google",
  ])("%s 在外壳外面", (href) => {
    expect(isInShell(href)).toBe(false);
  });

  it("别的网站上的网址不算，哪怕路径一样", () => {
    expect(isInShell("https://github.com/conversations")).toBe(false);
  });
});

describe("外壳顶上的通话条", () => {
  it("没在通话时哪里都没有", () => {
    expect(showsShellCallBar("/settings", null)).toBe(false);
    expect(showsShellCallBar("/conversations", null)).toBe(false);
  });

  it("通话中在设置、玩法页和它的子页、对话列表、别人的对话页上出现", () => {
    expect(showsShellCallBar("/settings", "mano")).toBe(true);
    expect(showsShellCallBar("/play", "mano")).toBe(true);
    expect(showsShellCallBar("/play/gifts", "mano")).toBe(true);
    expect(showsShellCallBar("/play/tasks", "mano")).toBe(true);
    expect(showsShellCallBar("/settings?tab=call", "mano")).toBe(true);
    expect(showsShellCallBar("/conversations", "mano")).toBe(true);
    expect(showsShellCallBar("/conversation/hiori", "mano")).toBe(true);
    expect(showsShellCallBar("/conversation/group/g1", "mano")).toBe(true);
  });

  it("她自己的对话页上不出现：那里有页首下面那条", () => {
    expect(showsShellCallBar("/conversation/mano", "mano")).toBe(false);
  });

  it("外壳外面不出现", () => {
    expect(showsShellCallBar("/admin", "mano")).toBe(false);
  });
});

describe("去某个网址时通话怎么样", () => {
  it("没在通话时哪里都直接走", () => {
    for (const to of ["/conversations", "/conversation/hiori", "/settings", "/admin", "/about"])
      expect(departure(to, null), to).toBe("go");
  });

  it("通话中在外壳里换页，通话留着", () => {
    expect(departure("/conversations", "mano")).toBe("keep");
    expect(departure("/conversation/group/g1", "mano")).toBe("keep");
    expect(departure("/settings", "mano")).toBe("keep");
    expect(departure("/settings?tab=own-keys", "mano")).toBe("keep");
    expect(departure("/settings/memories", "mano")).toBe("keep");
    expect(departure("/play", "mano")).toBe("keep");
    expect(departure("/play/gifts?to=hiori", "mano")).toBe("keep");
    expect(departure("/play/tasks", "mano")).toBe("keep");
  });

  it("通话中回她自己的对话页，通话留着", () => {
    expect(departure("/conversation/mano", "mano")).toBe("keep");
  });

  it("通话中打开另一位角色的对话，先问再挂断", () => {
    expect(departure("/conversation/hiori", "mano")).toBe("ask");
  });

  it("通话中离开外壳，先问再挂断", () => {
    for (const to of ["/admin", "/about", "/privacy", "/terms", "/", "/api/auth/link/google"])
      expect(departure(to, "mano"), to).toBe("ask");
  });
});

describe("导航栏和 dock 的当前项", () => {
  it.each([
    ["/conversation/mano", "conversations"],
    ["/settings", "settings"],
    ["/settings/own-keys", "settings"],
    ["/play", "play"],
    ["/play/gifts?to=mano", "play"],
    ["/play/tasks", "play"],
  ] as const)("%s 的当前项是 %s", (href, item) => {
    expect(currentNavItem(href)).toBe(item);
  });

  it("外壳外面没有当前项", () => {
    expect(currentNavItem("/admin")).toBeNull();
  });
});

describe("礼物子页在不在眼前（到账当场记成看过）", () => {
  it("在礼物子页上就在眼前，带着预选的也是", () => {
    expect(isGiftsSubpageInView("/play/gifts", false)).toBe(true);
    expect(isGiftsSubpageInView("/play/gifts?to=mano", false)).toBe(true);
  });

  it("通话层展开着盖住礼物子页时不在眼前", () => {
    expect(isGiftsSubpageInView("/play/gifts", true)).toBe(false);
  });

  it("玩法页第一级和每日任务与成就子页不算", () => {
    expect(isGiftsSubpageInView("/play", false)).toBe(false);
    expect(isGiftsSubpageInView("/play/tasks", false)).toBe(false);
  });

  it("别的页面上不在眼前", () => {
    expect(isGiftsSubpageInView("/conversation/mano", false)).toBe(false);
    expect(isGiftsSubpageInView("/gifts", false)).toBe(false);
  });
});

describe("导航栏、dock 上的点", () => {
  const both = { conversations: true, rewards: true };

  it("「对话」有没看过的搭话、「玩法」有新到的抽奖次数时各亮各的", () => {
    expect(navDots("settings", both)).toEqual({ conversations: true, play: true, settings: false });
    expect(navDots("settings", { conversations: false, rewards: true })).toEqual({
      conversations: false,
      play: true,
      settings: false,
    });
    expect(navDots("settings", { conversations: true, rewards: false }).play).toBe(false);
  });

  it("当前项是「玩法」时「玩法」不亮，别的照旧", () => {
    expect(navDots("play", both)).toEqual({ conversations: true, play: false, settings: false });
  });

  it("在外壳外面（没有当前项）时照常", () => {
    expect(navDots(null, both).play).toBe(true);
  });
});

describe("点导航栏、dock 里的一项去哪", () => {
  it("点别的项，去那一项的第一级", () => {
    expect(navDestination("settings", "/conversation/mano")).toBe("/settings");
    expect(navDestination("play", "/settings/call")).toBe("/play");
  });

  it("在二级页面上（她的对话页、玩法的子页、设置的一类）再点当前那一项，回到这一项的第一级", () => {
    expect(navDestination("conversations", "/conversation/mano")).toBe("/conversations");
    expect(navDestination("play", "/play/gifts")).toBe("/play");
    expect(navDestination("play", "/play/tasks?x=1")).toBe("/play");
    expect(navDestination("settings", "/settings/call")).toBe("/settings");
  });

  it("已经在第一级时再点当前那一项，不动", () => {
    expect(navDestination("conversations", "/conversations")).toBeNull();
    expect(navDestination("play", "/play")).toBeNull();
  });
});

describe("手机上在打字（dock 藏起来）", () => {
  it.each([
    ["textarea", { tagName: "TEXTAREA" }],
    ["搜索框", { tagName: "INPUT", type: "search" }],
    ["可编辑元素", { tagName: "DIV", isContentEditable: true }],
  ])("焦点在%s上算", (_, focused) => {
    expect(isTyping(focused)).toBe(true);
  });

  it.each([
    ["没有焦点", null],
    ["勾选框", { tagName: "INPUT", type: "checkbox" }],
    ["按钮", { tagName: "BUTTON" }],
  ])("%s不算", (_, focused) => {
    expect(isTyping(focused)).toBe(false);
  });
});
