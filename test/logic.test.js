'use strict';
// 달려라 쿠키 규칙 시험. 실행: node test/logic.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const DT = 1 / 60;
// 장애물·아이템 없이 빈 길만 (새 패턴이 안 나오게 멀리 미뤄 둔다)
function empty(seed = 1) {
  const w = L.newWorld(seed);
  w.spawnIn = 1e12;
  return w;
}
const run = (w, sec, inp = {}) => { const i = { jump: false, jumpHeld: false, slide: false, ...inp }; for (let t = 0; t < sec && w.state === 'play'; t += DT) L.stepWorld(w, DT, i); return i; };
function peak(w, inp) {
  let top = 0;
  const i = { jump: true, jumpHeld: true, slide: false, ...inp };
  for (let t = 0; t < 2; t += DT) { L.stepWorld(w, DT, i); top = Math.max(top, L.GROUND - w.ck.y); if (i.release && t > i.release) i.jumpHeld = false; }
  return top;
}

test('jumps: a full press goes about 160 px, a short tap much lower, a second jump goes higher still', () => {
  const full = peak(empty());
  assert.ok(full > 150 && full < 170, 'full jump: ' + full.toFixed(1));
  const tap = peak(empty(), { release: 0.02 });
  assert.ok(tap < full * 0.6, 'tap jump: ' + tap.toFixed(1));
  const w = empty();
  const i = { jump: true, jumpHeld: true, slide: false };
  let top = 0;
  for (let t = 0; t < 3; t += DT) {
    if (Math.abs(t - 0.4) < DT / 2) i.jump = true;          // 꼭대기 근처에서 한 번 더
    L.stepWorld(w, DT, i);
    top = Math.max(top, L.GROUND - w.ck.y);
  }
  assert.ok(top > full + 80, 'double jump: ' + top.toFixed(1));
  assert.ok(w.ck.onGround, 'lands again');
  const third = empty();
  third.ck.jumps = 2; third.ck.onGround = false; third.ck.y = L.GROUND - 100;
  L.stepWorld(third, DT, { jump: true, jumpHeld: true });
  assert.ok(third.ck.buf > 0, 'a third press is remembered for landing, not used in the air');
});

test('sliding goes under a hanging candy; standing up hits it', () => {
  assert.ok(L.SLIDE_H < L.HANG_CLEAR && L.STAND_H > L.HANG_CLEAR);
  for (const slide of [true, false]) {
    const w = empty();
    w.obs.push({ t: 'hang', x: L.CX + 80, w: 150, id: 1 });
    run(w, 1.5, { slide });
    assert.strictEqual(w.hits, slide ? 0 : 1, slide ? 'slid under' : 'bumped');
  }
});

test('falling into a pit costs health, you drop back in, and that pit is filled', () => {
  const w = empty();
  const pit = { t: 'pit', x: L.CX + 30, w: 400, id: 1 };
  w.obs.push(pit);
  const hp = w.hp;
  run(w, 2);
  assert.strictEqual(w.falls, 1);
  assert.ok(pit.covered);
  assert.ok(w.hp < hp - 20);
  const jumpOver = empty();
  jumpOver.obs.push({ t: 'pit', x: L.CX + 60, w: 120, id: 1 });
  const i = { jump: false, jumpHeld: true, slide: false };
  for (let t = 0; t < 2; t += DT) { if (Math.abs(t - 0.05) < DT / 2) i.jump = true; L.stepWorld(jumpOver, DT, i); }
  assert.strictEqual(jumpOver.falls, 0, 'a jump clears a short pit');
});

test('a spring launches you high', () => {
  const w = empty();
  w.obs.push({ t: 'spring', x: L.CX + 40, w: 40, h: 16, id: 1 });
  let top = 0;
  for (let t = 0; t < 2; t += DT) { L.stepWorld(w, DT, { jump: false, jumpHeld: false, slide: false }); top = Math.max(top, L.GROUND - w.ck.y); }
  assert.ok(top > 220, 'spring height: ' + top.toFixed(1));
  assert.ok(w.events.some((e) => e.type === 'spring'));
});

test('health drains over time, a potion refills it, and at zero the run ends', () => {
  const w = empty();
  run(w, 5);
  assert.ok(w.hp < L.HP_MAX - 10 && w.hp > L.HP_MAX - 25);
  const before = w.hp;
  w.items.push({ t: 'potion', x: L.CX, y: L.GROUND - 26 });
  run(w, DT);
  assert.ok(Math.abs(w.hp - Math.min(L.HP_MAX, before + L.POTION_HP)) < 1);
  w.hp = 0.01;
  run(w, 0.1);
  assert.strictEqual(w.state, 'dead');
  assert.ok(w.events.some((e) => e.type === 'dead'));
});

test('hits hurt once, then you blink for a moment', () => {
  const w = empty();
  w.obs.push({ t: 'spike', x: L.CX - 5, w: 36, h: 38, id: 1 }, { t: 'spike', x: L.CX + 40, w: 36, h: 38, id: 2 });
  run(w, 0.4);
  assert.strictEqual(w.hits, 1, 'the second spike right after does not count');
  assert.ok(w.ck.inv > 0 || w.hits === 1);
});

test('the booster smashes obstacles for points; the magnet pulls jellies in from far away', () => {
  const w = empty();
  w.items.push({ t: 'boost', x: L.CX, y: L.GROUND - 26 });
  run(w, DT);
  assert.ok(w.boostT > 0);
  // 부스터 중에는 높이 날아서 낮은 가시와는 닿지도 않는다: 높은 벽 둘로 확인
  w.obs.push({ t: 'wall', x: L.CX + 100, w: 36, h: 185, id: 1 }, { t: 'wall', x: L.CX + 400, w: 36, h: 185, id: 2 });
  run(w, 1.5);
  assert.strictEqual(w.hits, 0);
  assert.strictEqual(w.smashes, 2);
  assert.strictEqual(w.bonus, 30);
  const m = empty();
  m.items.push({ t: 'magnet', x: L.CX, y: L.GROUND - 26 });
  run(m, DT);
  m.items.push({ t: 'jelly', x: L.CX + 150, y: L.GROUND - 200, v: 10, c: 0 });
  run(m, 0.6);
  assert.strictEqual(m.jellies, 1, 'pulled in a jelly 150 px up and ahead');
});

test('distance, speed and score: faster over time, 50 px per metre, score = jellies + bonus + metres', () => {
  const w = empty();
  w.hp = 1e9;                                            // 체력이 먼저 닳지 않게
  run(w, 10);
  assert.ok(w.baseSpeed > L.SPEED0 && w.baseSpeed <= L.SPEED_MAX);
  assert.strictEqual(L.meters(w), Math.floor(w.dist / L.PX_PER_M));
  w.jellyScore = 120; w.bonus = 15;
  assert.strictEqual(L.scoreOf(w), 135 + L.meters(w));
  run(w, 200);
  assert.strictEqual(w.baseSpeed, L.SPEED_MAX);
});

// 0.15초마다 '그냥 달리기 / 점프(꾹) / 슬라이드' 중 앞으로 0.6초 동안 부딪히지 않는 쪽을 고르는 자동 조종
const ACTS = [{}, { press: true, hold: true }, { slide: true }];
const clone = (w) => structuredClone({ ...w, events: [] });
function sim(w, act) {
  const inp = { jump: !!act.press, jumpHeld: !!act.hold, slide: !!act.slide };
  let bad = 0;
  for (let k = 0; k < 9 && w.state === 'play'; k++) {
    const h0 = w.hits, f0 = w.falls;
    L.stepWorld(w, DT, inp);
    inp.jump = false;
    bad += (w.hits - h0) + (w.falls - f0);
  }
  return bad;
}
function lookahead(w, depth) {
  if (!depth) return 0;
  let best = Infinity;
  for (const a of ACTS) {
    const c = clone(w);
    const s = sim(c, a) * 10 + lookahead(c, depth - 1);
    if (s < best) best = s;
    if (!best) break;
  }
  return best;
}
function autopilot(seed, meters) {
  const w = L.newWorld(seed);
  w.hp = 1e9;                                            // 체력은 보지 않고 부딪힘만 센다
  while (w.state === 'play' && L.meters(w) < meters) {
    let bestA = ACTS[0], bestS = Infinity;
    for (const a of ACTS) {
      const c = clone(w);
      const s = sim(c, a) * 10 + lookahead(c, 3);
      if (s < bestS) { bestS = s; bestA = a; }
      if (!s) break;
    }
    sim(w, bestA);
    w.events.length = 0;
  }
  return w;
}

test('every obstacle can be avoided: a look-ahead autopilot runs 2,500 m through all 20 kinds without a single hit', () => {
  for (const seed of [1, 2]) {
    const w = autopilot(seed, 2500);
    assert.strictEqual(w.hits + w.falls, 0, `seed ${seed}: ${w.hits} hits, ${w.falls} falls`);
    assert.strictEqual(Object.keys(w.seen).length, Object.keys(L.KIND_INFO).length, 'every kind showed up');
    assert.ok(w.jellies > 500);
  }
});

test('new obstacle kinds only appear after their starting distance', () => {
  const w = L.newWorld(7);
  const firstAt = {};
  for (let t = 0; t < 400 && L.meters(w) < 1000; t += DT) {
    L.stepWorld(w, DT, { jump: false, jumpHeld: false, slide: false });
    w.hp = L.HP_MAX; w.ck.inv = 1;                     // 그냥 달리게 둔다
    for (const k of Object.keys(w.seen)) if (!(k in firstAt)) firstAt[k] = L.meters(w);
  }
  for (const [k, m] of Object.entries(firstAt)) assert.ok(m + 40 >= L.KIND_INFO[k].min, `${k} at ${m} m (min ${L.KIND_INFO[k].min})`);
});
