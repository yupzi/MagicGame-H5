import { makeCanvas, makeSprite, tintSprite, type Sprite } from "../engine/gfx";
import { P } from "./palette";

export type ItemType = "wood" | "stone" | "crystal" | "gel" | "fur" | "apple" | "meat";
export const ITEM_ORDER: ItemType[] = ["wood", "stone", "crystal", "gel", "fur", "apple", "meat"];

const pal: Record<string, string> = {
  o: P.outline, w: P.white,
  b: P.bark, B: P.barkDark, y: P.barkLight, t: "#f3d19a",
  g: P.stone, G: P.stoneDark, h: P.stoneHi,
  p: P.crystal, q: P.crystalDark, k: P.crystalHi,
  c: P.slime, C: P.slimeDark, s: P.slimeHi,
  f: P.bunny, F: P.bunnyShade,
  r: P.red, R: "#c9304e", l: P.leaf, L: P.leafDark,
  m: "#e58a6a", M: "#b85c4a", e: P.cream,
  H: P.heart, j: P.heartHi, d: P.heartEmpty, D: "#4d3354",
  Y: P.magicYellow, Z: "#ffd24a",
  a: P.fire, A: P.fireDark, n: P.fireHi,
  i: P.ice, I: P.iceDark, v: P.volt, V: P.voltBlue, P: P.magicPink,
  u: P.hat, U: P.hatDark, x: P.magicPurple,
};

const MAPS: Record<ItemType, string[]> = {
  wood: [
    ".oooooo.",
    "obbbbbto",
    "oBbBbbyo",
    "obbbbbto",
    ".oooooo.",
  ],
  stone: [
    "..ooo..",
    ".ohggo.",
    "ohgggGo",
    "ogggGGo",
    ".ooooo.",
  ],
  crystal: [
    "...o...",
    "..oko..",
    ".okppo.",
    ".oppqo.",
    "..opo..",
    "...o...",
  ],
  gel: [
    "..ooo..",
    ".oscco.",
    "oscccco",
    "occcCCo",
    ".ooooo.",
  ],
  fur: [
    ".o.o.o.",
    "ofofofo",
    "offfffo",
    "oFfffFo",
    ".ooooo.",
  ],
  apple: [
    "...oll.",
    ".oo.oo.",
    "orwrrro",
    "orrrrro",
    "orrrrRo",
    ".orrRo.",
    "..ooo..",
  ],
  meat: [
    "..ooo..",
    ".ommmo.",
    "omMmmmo",
    "ommmMmo",
    ".ommmo.",
    "..oeo..",
    "..ooo..",
  ],
};

export type IconId =
  | "star" | "fire" | "ice" | "thunder" | "flower" | "heart" | "feather"
  | "grimoire" | "star_dmg" | "star_multi" | "charge_speed" | "charge_power"
  | "fire_radius" | "fire_burn" | "ice_pierce" | "ice_freeze" | "shatter"
  | "thunder_chain" | "thunder_dmg" | "speed" | "harvest" | "magnet" | "lucky";

const ICONS: Record<IconId, string[]> = {
  flower: [
    "..oo.oo..",
    ".oPPoPPo.",
    ".oPwPwPo.",
    "..oPYPo..",
    ".oPPYPPo.",
    ".oPPoPPo.",
    "..oolLo..",
    "...olLo..",
    "....oo...",
  ],
  star: [
    "....o....",
    "...oYo...",
    "...oYo...",
    "oooYwYooo",
    "oYYwwwYYo",
    ".oYYwYYo.",
    "..oYYYo..",
    ".oYYoYYo.",
    ".ooo.ooo.",
  ],
  fire: [
    "...o.....",
    "..oao..o.",
    "..oaaooao",
    ".oaanaaao",
    "oaannnaao",
    "oannwnnao",
    "oAannnaAo",
    ".oAAaAAo.",
    "..ooooo..",
  ],
  ice: [
    "....o....",
    "...owo...",
    "..owio...",
    "..owiIo..",
    ".owiiIo..",
    ".owiiIIo.",
    ".owiIIIo.",
    "..oiIIo..",
    "...ooo...",
  ],
  thunder: [
    "...oooooo",
    "..ovvvvo.",
    "..ovvvo..",
    ".ovvvoooo",
    ".ovwvvvvo",
    "oooovvvo.",
    "...ovvo..",
    "..ovvo...",
    "..ooo....",
  ],
  heart: [
    ".........",
    ".oo...oo.",
    "oHjHoHHHo",
    "oHjHHHHHo",
    "oHHHHHHHo",
    ".oHHHHHo.",
    "..oHHHo..",
    "...oHo...",
    "....o....",
  ],
  grimoire: [
    ".ooooooo.",
    "ouuuuuuUo",
    "ouuuYuuUo",
    "ouuYwYuUo",
    "ouuuYuuUo",
    "ouuuuuuUo",
    "oeeeeeeUo",
    "oyyyyyyyo",
    ".ooooooo.",
  ],
  star_dmg: [
    "....o....",
    "...oYo...",
    "...oYo...",
    ".ooYwYoo.",
    "oYYwwwYYo",
    ".ooYwYoo.",
    "...oYo...",
    "...oYo...",
    "....o....",
  ],
  star_multi: [
    ".o.......",
    "oYo...o..",
    ".o...oYo.",
    "......o..",
    "..o......",
    ".oYo...o.",
    "..o...oYo",
    ".......o.",
    ".........",
  ],
  charge_speed: [
    "ooooooooo",
    ".oyyyyyo.",
    "..oYYYo..",
    "...oYo...",
    "....o....",
    "...oeo...",
    "..oeYeo..",
    ".oYYYYYo.",
    "ooooooooo",
  ],
  charge_power: [
    "...oYo...",
    "...YwY...",
    "...YwY...",
    "...YwY...",
    "...YwY...",
    "..PYwYP..",
    ".PoooooP.",
    "P.......P",
    ".PPPPPPP.",
  ],
  fire_radius: [
    "o...o...o",
    ".oa.a.ao.",
    "..anana..",
    ".aannnaa.",
    "onnnwnnno",
    ".aannnaa.",
    "..anana..",
    ".oa.a.ao.",
    "o...o...o",
  ],
  fire_burn: [
    ".....o...",
    "....oao..",
    ".o..oaao.",
    "oao.oanao",
    "oanoanwao",
    "oanwaanao",
    "oAaaoAaAo",
    ".oAAooAo.",
    "..oo..oo.",
  ],
  ice_pierce: [
    "........o",
    "......ooi",
    ".....owio",
    "....owio.",
    "o..owio..",
    "oooiio...",
    ".oIIo....",
    "oIoo.....",
    "oo.......",
  ],
  ice_freeze: [
    "....o....",
    ".o.oio.o.",
    "..owiwo..",
    ".oiwiwio.",
    "oiiiwiiio",
    ".oiwiwio.",
    "..owiwo..",
    ".o.oio.o.",
    "....o....",
  ],
  shatter: [
    "i.......i",
    ".i..o..i.",
    "...oio...",
    "..oiwIo..",
    ".oiwoIIo.",
    "..oiIIo..",
    "...oIo...",
    ".i..o..i.",
    "i.......i",
  ],
  thunder_chain: [
    ".ooo.....",
    "ovvvo....",
    "ov.vo....",
    "ovvvvo...",
    ".oovvvoo.",
    "...ovvvvo",
    "....ov.vo",
    "....ovvvo",
    ".....ooo.",
  ],
  thunder_dmg: [
    "...ooooo.",
    "..ovvvvo.",
    ".ovvwvo..",
    ".ovwvoooo",
    "ovwwwvvvo",
    "oooovwvo.",
    "...ovvo..",
    "..ovvo...",
    "..ooo....",
  ],
  speed: [
    ".........",
    "..oooo...",
    "..ouuo...",
    "o.ouuo...",
    ".oouuooo.",
    "o.ouuuuuo",
    ".ouuuuuuo",
    ".oUUUUUUo",
    ".ooooooo.",
  ],
  magnet: [
    ".ooo.ooo.",
    "owwo.owwo",
    "orro.oggo",
    "orro.oggo",
    "orroooggo",
    "orrrrgggo",
    ".orrrggo.",
    "..ooooo..",
    ".........",
  ],
  harvest: [
    "......oo.",
    ".....olLo",
    "....ollo.",
    ".ooooLoo.",
    "obbbbbto.",
    "oBbBbbyo.",
    "obbbbbto.",
    ".oooooo..",
    ".........",
  ],
  lucky: [
    "w...o....",
    "...oko...",
    "..okppo..",
    "..okppo.w",
    ".okpppqo.",
    ".opppqqo.",
    "..oppqo..",
    "...oqo...",
    "....o....",
  ],
  feather: [
    "......oo.",
    ".....owio",
    "....owiio",
    "...owiiIo",
    "..owiiIo.",
    ".owiiIo..",
    ".oiiIo...",
    "oooo.....",
    "o........",
  ],
};

export const iconSprites = {} as Record<IconId, Sprite>;
export const iconSpritesWhite = {} as Record<IconId, Sprite>;
export const iconSpritesDim = {} as Record<IconId, Sprite>;

export const itemSprites = {} as Record<ItemType, Sprite>;
export const itemSpritesWhite = {} as Record<ItemType, Sprite>;

export let heartFull: Sprite;
export let heartEmpty: Sprite;
export let heartHalfWhite: Sprite;
export let heartHalf: Sprite;
export let starSprite: Sprite;
export let starSmall: Sprite;

export function buildSprites() {
  for (const k of ITEM_ORDER) {
    itemSprites[k] = makeSprite(MAPS[k], pal);
    itemSpritesWhite[k] = tintSprite(itemSprites[k], P.white);
  }
  for (const k of Object.keys(ICONS) as IconId[]) {
    iconSprites[k] = makeSprite(ICONS[k], pal);
    iconSpritesWhite[k] = tintSprite(iconSprites[k], P.white);
    iconSpritesDim[k] = tintSprite(iconSprites[k], "#6a5a90");
  }
  heartFull = makeSprite([
    ".oo.oo.",
    "oHjHHHo",
    "oHHHHHo",
    ".oHHHo.",
    "..oHo..",
    "...o...",
  ], pal);
  heartEmpty = makeSprite([
    ".oo.oo.",
    "odDdddo",
    "oddddDo",
    ".odddo.",
    "..odo..",
    "...o...",
  ], pal);
  heartHalfWhite = tintSprite(heartFull, P.white);
  // Left half full, right half empty.
  heartHalf = makeCanvas(heartFull.width, heartFull.height)[0];
  const hg = heartHalf.getContext("2d")!;
  hg.drawImage(heartEmpty, 0, 0);
  hg.drawImage(heartFull, 0, 0, 4, heartFull.height, 0, 0, 4, heartFull.height);
  starSprite = makeSprite([
    "..Y..",
    ".YYY.",
    "YYwYY",
    ".YYY.",
    ".Y.Y.",
  ], pal);
  starSmall = makeSprite([
    ".Y.",
    "YwY",
    ".Y.",
  ], pal);
}
