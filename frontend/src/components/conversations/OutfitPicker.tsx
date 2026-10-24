"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { copy } from "@/i18n";
import type { Outfit } from "@/lib/api";
import { CALM } from "@/lib/standAnimations";
import { findOutfit, LOOKS, type ListedOutfit, type Look, type OutfitCard } from "@/lib/standOutfit";
import { cn } from "@/lib/utils";
import { herVars } from "@/theme/herVars";
import { Ja } from "@/theme/Ja";

import { Stand } from "./stand/Stand";
import type { StandFormat } from "./stand/standEngine";
import type { StandOutfits } from "./useStandOutfits";

const t = copy.conversation.outfits;

type Props = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** 宽屏打开对话框，窄屏打开底部面板（和对话页同一个断点）。 */
  isWide: boolean;
  isReducedMotion: boolean;
  /** 她的印象色：浮层渲染到对话子树外面，在浮层内容上再注入一次（大预览铺她的壁纸，「穿这套」是她的 primary）。 */
  color: string;
  outfits: StandOutfits;
  /** 她的立绘用哪套引擎（characters.toml 的 stand_format，随角色 API 下发）。 */
  format: StandFormat;
};

/**
 * 换衣装（spec「衣装与换衣装」，DESIGN.md「Overlays」）：宽屏是对话框，左边是大预览；窄屏是底部面板，
 * 大预览在上面，随列表一起滚动。大预览的底是她的壁纸。列表按衣装清单的顺序排卡片，每张卡有缩略图、
 * 卡名和「私服 / 演出」切换，正在预览的卡铺中性的 `bg-muted`。点卡片只是预览，
 * 点「穿这套」才记在这台设备上，下次打电话她就穿这套。
 */
export function OutfitPicker({ isOpen, onOpenChange, isWide, isReducedMotion, color, outfits, format }: Props) {
  const { cards, worn } = outfits;
  // 还没点过卡片时预览她正在穿的那套；关上时忘掉点过的，下次打开又从正在穿的看起。
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = pickedId ?? worn.id;
  // 大预览最近试的那套载入了没有：画面上是不是这一套，由它判断。
  const [tried, setTried] = useState<{ url: string; isLoaded: boolean } | null>(null);
  const openChange = (open: boolean) => {
    if (!open) {
      setPickedId(null);
      setTried(null);
    }
    onOpenChange(open);
  };

  const found = findOutfit(cards ?? [], picked);
  // 清单里找不到（例如清单没读到时正在穿的那套）也照样预览。
  const previewed: Outfit = found?.outfit ?? worn;
  const isWorn = previewed.id === worn.id;
  // 预览没画出这一套（还在载入，或者载入不到）时不能穿：看到的得是要穿的那套。
  const isShown = tried?.url === previewed.url && tried.isLoaded;
  const isBroken = tried?.url === previewed.url && !tried.isLoaded;
  const wear = () => {
    outfits.wear(previewed.id);
    openChange(false);
  };

  const preview = (
    <div className="flex w-full flex-col items-center gap-3">
      <div className={cn("w-full overflow-hidden rounded-xl bg-her-wall", isWide ? "h-96" : "h-54")}>
        {/* 关上时卸下，引擎和素材一起释放 */}
        {isOpen && (
          <Stand
            outfits={[previewed]}
            framing="full"
            format={format}
            isPaused={false}
            entrance="fade"
            direction={CALM}
            isReducedMotion={isReducedMotion}
            onTried={(outfit, isLoaded) => setTried({ url: outfit.url, isLoaded })}
          />
        )}
      </div>
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-medium">
          <Ja>{found && t.cardName(found.card.name)}</Ja>
        </p>
        <p className="text-xs text-muted-foreground">
          {[found && t.lookNames[found.look], found?.card.type, isWorn && t.wearing, isBroken && t.notLoaded]
            .filter(Boolean)
            .join(t.separator)}
        </p>
      </div>
      <Button onClick={wear} disabled={isWorn || !isShown}>
        {t.wear}
      </Button>
    </div>
  );

  const list =
    cards === null ? (
      <div className="flex justify-center p-6">
        <Spinner className="size-6 text-muted-foreground" aria-label={t.loading} />
      </div>
    ) : outfits.isListFailed ? (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t.loadFailed}</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={outfits.reloadList}>
            {t.retry}
          </Button>
        </EmptyContent>
      </Empty>
    ) : (
      <div className={cn("grid gap-3", isWide ? "grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]" : "grid-cols-3")}>
        {cards.map((card) => (
          <CardTile key={card.id} card={card} picked={picked} onPick={setPickedId} />
        ))}
      </div>
    );

  // 浮层渲染到对话子树外面，在内容上再注入一次她的颜色（DESIGN.md「The Scoped Colour Rule」）。
  const her = herVars(color);

  if (isWide) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => openChange(open)}>
        <DialogContent style={her} className="flex max-h-[86dvh] flex-col sm:max-w-240">
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription>{t.hint}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 items-start gap-6 overflow-y-auto">
            <div className="sticky top-0 w-75 shrink-0">{preview}</div>
            <div className="min-w-0 flex-1">{list}</div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={isOpen} onOpenChange={(open) => openChange(open)} showSwipeHandle>
      <DrawerContent style={her}>
        <DrawerHeader>
          <DrawerTitle>{t.title}</DrawerTitle>
          <DrawerDescription>{t.hint}</DrawerDescription>
        </DrawerHeader>
        {/* 大预览和列表一起滚动 */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
          {preview}
          {list}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * 一张卡：缩略图、卡名（固定占两行，超出截断，悬停时显示全名）和「私服 / 演出」切换，
 * 只有一套的卡是灰掉的「只有一套」，所有卡片一样高。切换和点缩略图都会预览这一套。
 */
function CardTile({ card, picked, onPick }: { card: OutfitCard; picked: string; onPick: (id: string) => void }) {
  const looks = LOOKS.filter((look) => card[look]);
  const pickedLook = looks.find((look) => card[look]?.id === picked);
  const [chosen, setChosen] = useState<Look>(looks[0]);
  // 这张卡上的某一套被选中时（例如打开时正在穿的是演出服），切换跟着它。
  const look = pickedLook ?? chosen;
  const outfit = card[look] as ListedOutfit;
  const isPicked = pickedLook !== undefined;
  return (
    <div className={cn("flex flex-col gap-1 rounded-xl p-1", isPicked && "bg-muted")}>
      {/*
       * 缩略图是一个按钮，4:5，铺满卡片宽度，还没下载到时也占着同样的位置，大小不看里面的图（contain: strict）。
       * 图绝对定位铺满按钮：宽度是百分比的图载入时，浏览器会把它往上的每一层都标成要重排，留在弹性布局里就是
       * 一路重排到整个面板（60 多张卡，一次约 5ms），滚动中缩略图陆续载入，高刷新率的屏幕上就掉帧；
       * 脱离弹性布局之后只重排按钮里面。
       */}
      <button
        type="button"
        aria-label={t.preview(card.name)}
        aria-pressed={isPicked}
        onClick={() => onPick(outfit.id)}
        className="relative aspect-[4/5] cursor-pointer overflow-hidden rounded-lg outline-none [contain:strict] focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {/* 缩略图同步素材时预先渲染好（400×500），滚到了才下载 */}
        <img
          src={outfit.thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      </button>
      <p title={card.name} className="line-clamp-2 h-8 px-0.5 text-xs leading-4">
        <Ja>{card.name}</Ja>
      </p>
      {looks.length > 1 ? (
        <ToggleGroup
          aria-label={t.lookLabel(card.name)}
          variant="segment"
          size="sm"
          spacing={0}
          className="w-full"
          value={[look]}
          onValueChange={(value: unknown[]) => {
            const next = value[0] as Look | undefined;
            // 再点一下当前这一项不会取消选中。
            if (!next) return;
            setChosen(next);
            onPick((card[next] as ListedOutfit).id);
          }}
        >
          {LOOKS.map((value) => (
            <ToggleGroupItem key={value} value={value} className="flex-1">
              {t.looks[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      ) : (
        <ToggleGroup aria-label={t.lookLabel(card.name)} variant="segment" size="sm" spacing={0} className="w-full" value={["only"]} disabled>
          <ToggleGroupItem value="only" className="flex-1">
            {t.only}
          </ToggleGroupItem>
        </ToggleGroup>
      )}
    </div>
  );
}
