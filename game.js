'use strict';

// ---------- Board ----------
const W = 720, H = 450;              // 기본 화면(px). 폰 전체화면에서는 가로가 더 넓어질 수 있다 (world.viewW)
const GROUND = 330;                 // 달리는 바닥 높이
const CX = 150;                     // 쿠키가 서 있는 화면 x (세상이 왼쪽으로 흐른다)
const PX_PER_M = 50;

// ---------- Tuning ----------
// 쿠키런 같은 조작감: 점프가 크고 살짝 떠 있는 느낌(공중에 0.8초쯤), 누르는 시간만큼 높이 뜨고, 한 번 더 누르면 2단,
// 공중에서 슬라이드를 누르면 쿵 내려온다.
const GRAV = 1900;                  // px/s²
const JUMP_V = 780;                 // 첫 점프 (끝까지 누르면 꼭대기 약 160px)
const JUMP2_V = 700;                // 두 번째 점프 (그 자리에서 약 130px 더)
const CUT_V = 300;                  // 점프 버튼을 일찍 떼면 상승 속도를 이만큼으로 줄인다 (짧게 톡 = 낮은 점프)
const FAST_FALL = 1400;             // 공중에서 슬라이드를 누르면 빨리 내려온다
const SPEED0 = 360, SPEED_MAX = 700, ACCEL = 4;   // px/s, 초당 증가
const BOOST_MUL = 1.55;
const HP_MAX = 100;
const DRAIN0 = 3.2, DRAIN1 = 7.0;   // 초당 체력 감소 (240초에 걸쳐 늘어남)
const HIT_DMG = 18, FALL_DMG = 25, POTION_HP = 30;
const BOOST_T = 3.2, MAGNET_T = 6, INV_T = 1.4;
const HALF_W = 13;                  // 쿠키 몸 절반 폭
const STAND_H = 50, SLIDE_H = 24;
const HANG_CLEAR = 42;              // 매달린 장애물 아래 틈: 서 있으면 부딪히고(50) 슬라이드하면(24) 지나간다
const COYOTE = 0.09, JUMP_BUF = 0.12;
const SNAP_R = 60;                  // 젤리가 쿠키 쪽으로 끌려오기 시작하는 거리
const SPRING_V = 1000;              // 스프링을 밟으면 튀어 오르는 속도 (꼭대기 약 260px, 그 뒤 2단 점프도 가능)
// 움직이는 장애물
const BAT_VX = 70;                  // 박쥐는 세상보다 이만큼 더 빨리 다가온다
const BAT_BASE = 68, BAT_AMP = 32, BAT_OM = 4.2;    // 박쥐 높이(발 기준)가 출렁이는 범위: 36~100. 슬라이드하면 언제나 지나갈 수 있다
const BALL_VX = 150;                // 굴러오는 사탕공은 더 빨리 굴러온다

// ---------- Random ----------
function rand(w) {
  let t = (w.seed = (w.seed + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------- Patterns ----------
// dx 는 패턴 시작점에서 오른쪽으로, h 는 바닥에서 위로의 높이(젤리 중심).
const jelly = (dx, h, c = 0, v = 10, big = false) => ({ t: 'jelly', dx, h, c, v, big });
function line(x0, n, h = 28, step = 44) { const a = []; for (let i = 0; i < n; i++) a.push(jelly(x0 + i * step, h, i % 4)); return a; }

// 점프 궤적 위에 젤리를 놓는다: 게임 물리(stepWorld)와 같은 식으로 '끝까지 누른 점프'의 발 높이를 시간별로 계산해 두고,
// 달리는 속도(x = 속도 × 시간)만큼 앞으로 펼친다. 그래서 타이밍을 맞춰 뛰면 곡선을 그대로 따라가며 다 먹을 수 있다.
const JDT = 1 / 120;
function jumpPath(second, v0 = JUMP_V) {
  const f = [0];                                   // f[i] = i번째 스텝의 발이 바닥에서 떠 있는 높이
  let y = 0, vy = -v0, t = 0, did = false;
  for (;;) {
    vy += GRAV * JDT; y += vy * JDT; t += JDT;
    if (second && !did && vy >= 0) { vy = -JUMP2_V; did = true; }   // 2단 점프는 꼭대기에서 한 번 더
    f.push(-y);
    if (y >= 0 && t > 0.05) break;
  }
  return { f, T: t };
}
const PATH1 = jumpPath(false), PATH2 = jumpPath(true), PATH_SPRING = jumpPath(false, SPRING_V);
const JELLY_STEP = 0.075;                          // 젤리 사이 시간 간격(초)
const halfSpan = (spd, path = PATH1) => spd * path.T / 2;       // 점프 한 번에 날아가는 거리의 절반
// center: 이 점프의 한가운데가 오는 x. 젤리 중심은 쿠키 몸 중심(발 + 26). bigTop 이면 꼭대기 젤리는 큰 젤리
function arcAt(center, spd, path = PATH1, bigTop = false) {
  const out = [], half = halfSpan(spd, path);
  let topI = -1, topF = -1;
  for (let t = JELLY_STEP, i = 0; t < path.T - 0.03; t += JELLY_STEP, i++) {
    const f = path.f[Math.round(t / JDT)];
    if (f > topF) { topF = f; topI = i; }
    out.push(jelly(center - half + spd * t, 26 + f, i % 4));
  }
  if (bigTop && out[topI]) { out[topI].big = true; out[topI].v = 50; }
  return out;
}

// 장애물. h 는 높이(또는 발판이 떠 있는 높이)
const spike = (dx, w = 36) => ({ t: 'spike', dx, w, h: 38 });
const thorn = (dx) => ({ t: 'thorn', dx, w: 40, h: 84 });
const hang = (dx, w = 150) => ({ t: 'hang', dx, w });
const pit = (dx, w) => ({ t: 'pit', dx, w });
const wall = (dx) => ({ t: 'wall', dx, w: 36, h: 185 });            // 한 번 점프로는 못 넘는 높은 벽: 2단 점프
const bat = (dx, ph) => ({ t: 'bat', dx, w: 46, h: 26, vx: BAT_VX, ph });   // 위아래로 출렁이며 다가오는 박쥐
const ball = (dx) => ({ t: 'ball', dx, w: 34, h: 34, vx: BALL_VX });       // 굴러오는 사탕공
const platform = (dx, w = 220, h = 78) => ({ t: 'platform', dx, w, h });    // 올라탈 수 있는 발판 (아래로 지나가도 된다)
const spring = (dx) => ({ t: 'spring', dx, w: 40, h: 16 });                 // 밟으면 높이 튀어 오름

// 장애물 사이 간격은 속도가 아니라 '시간'으로 잡는다 (빨라져도 반응할 시간이 비슷하게 남도록)
const gapFor = (spd) => spd * 0.85 + 60;           // 따로 나오는 패턴 사이
const chainGap = (spd) => spd * 0.45 + 30;         // 한 패턴 안에서 이어 붙인 장애물 사이
const spawnGap = (spd) => spd * 0.6 + 60;          // 패턴과 패턴 사이 (패턴 끝의 젤리 곡선 뒤에 더해진다)

// ---- 조각(primitive): 중심 c 기준으로 장애물과 젤리를 만든다. half = 이 조각이 차지하는 좌우 반폭
const PRIM = {
  line: { half: () => 160, build: (c) => ({ obs: [], items: line(c - 154, 8) }) },
  arc: { half: (s) => halfSpan(s), build: (c, s) => ({ obs: [], items: arcAt(c, s) }) },
  sky: { half: (s) => halfSpan(s, PATH2), build: (c, s) => ({ obs: [], items: arcAt(c, s, PATH2, true) }) },
  spike1: { half: (s) => halfSpan(s), build: (c, s) => ({ obs: [spike(c - 18)], items: arcAt(c, s) }) },
  spike2: { half: (s) => halfSpan(s), build: (c, s) => ({ obs: [spike(c - 63), spike(c + 27)], items: arcAt(c, s) }) },
  spike3: { half: (s) => halfSpan(s), build: (c, s) => ({ obs: [spike(c - 98), spike(c - 18), spike(c + 62)], items: arcAt(c, s) }) },
  thorn: { half: (s) => halfSpan(s), build: (c, s) => ({ obs: [thorn(c - 20)], items: arcAt(c, s) }) },
  hang: { half: () => 110, build: (c) => ({ obs: [hang(c - 75, 150)], items: line(c - 95, 6, 22, 38) }) },
  pit: { half: (s) => halfSpan(s), build: (c, s, w) => { const pw = 120 + Math.floor(rand(w) * 5) * 14; return { obs: [pit(c - pw / 2, pw)], items: arcAt(c, s) }; } },
  wall: { half: (s) => halfSpan(s, PATH2), build: (c, s) => ({ obs: [wall(c - 18)], items: arcAt(c, s, PATH2, true) }) },
  bat: { half: () => 110, build: (c, s, w) => ({ obs: [bat(c - 23, rand(w) * 6.28)], items: line(c - 76, 5, 24, 38) }) },
  // 사탕공은 세상보다 빨리 굴러와서, 공이 쿠키를 지나는 때에 맞춰 젤리 곡선을 놓는다 (공은 곡선보다 오른쪽 먼 곳에서 출발)
  ball: { half: (s) => halfSpan(s), build: (c, s, w, x0) => {
    const xs = x0 + c, xb = CX + (xs - CX) * (s + BALL_VX) / s;      // 공이 같은 순간에 쿠키에 닿도록 공의 출발 위치를 앞으로 미룬다
    return { obs: [ball(xb - x0 - 17)], items: arcAt(c, s), end: xb - x0 + 40 };
  } },
  platform: { half: () => 140, build: (c) => ({ obs: [platform(c - 110)], items: [...line(c - 85, 6, 78 + 26, 34), ...line(c - 85, 6, 28, 34)] }) },
  platPit: { half: () => 170, build: (c) => ({ obs: [pit(c - 115, 230), platform(c - 125, 250)], items: line(c - 100, 7, 78 + 26, 34) }) },
  spring: { half: (s) => halfSpan(s, PATH_SPRING) + 20, build: (c, s) => {
    const h = halfSpan(s, PATH_SPRING);
    return { obs: [spring(c - h - 20)], items: arcAt(c, s, PATH_SPRING, true) };
  } },
};

// 종류별 설정: min = 이 거리(m)부터 나옴, w = [처음 가중치, 많이 달린 뒤 가중치], rest = 장애물 없는 쉬어가기
const KIND_INFO = {
  line: { min: 0, w: [3, 1], rest: true }, arc: { min: 0, w: [2, 1], rest: true }, sky: { min: 60, w: [0.6, 1.4], rest: true },
  spike1: { min: 0, w: [5, 2] }, spike2: { min: 30, w: [2, 2] }, thorn: { min: 40, w: [1.4, 2.4] }, spike3: { min: 120, w: [0.5, 2.4] },
  hang: { min: 100, w: [1.4, 2.6] }, pit: { min: 180, w: [1.2, 2.8] }, bat: { min: 250, w: [1.4, 2.8] }, ball: { min: 320, w: [1.4, 2.8] },
  wall: { min: 450, w: [1.2, 2.4] }, platform: { min: 500, w: [1.2, 2] }, platPit: { min: 620, w: [1, 2] }, spring: { min: 560, w: [1, 1.8] },
};
// 구역(400m마다)마다 자주 나오는 장애물이 달라진다
const FAVOR = [
  ['spike1', 'spike2', 'spike3', 'pit', 'hang', 'arc'],          // 사탕 나라
  ['thorn', 'ball', 'bat', 'wall', 'line'],                      // 초코 숲
  ['platform', 'platPit', 'spring', 'sky', 'bat', 'pit'],        // 별밤 정원
];
const REST_KINDS = Object.keys(KIND_INFO).filter((k) => KIND_INFO[k].rest);
const HAZARD_KINDS = Object.keys(KIND_INFO).filter((k) => !KIND_INFO[k].rest);

function pickKind(w, m, lv, pool) {
  const bi = Math.floor(m / 400) % 3;
  let total = 0; const list = [];
  for (const k of pool) {
    const info = KIND_INFO[k];
    if (m < info.min) continue;
    let wt = info.w[0] + (info.w[1] - info.w[0]) * lv;
    if (FAVOR[bi].includes(k)) wt *= 2.2;
    if ((w.seen[k] || 0) < 2 && m - info.min < 160) wt *= 3;            // 새로 나온 장애물은 처음 몇 번 자주 보여 준다
    if (w.recent.includes(k)) wt *= info.rest ? 0.5 : 0.12;              // 같은 것이 연달아 나오지 않게
    list.push([k, wt]); total += wt;
  }
  let r = rand(w) * total;
  for (const [k, wt] of list) { r -= wt; if (r <= 0) return k; }
  return list[list.length - 1][0];
}
function composeKinds(w, m, lv) {
  const pRest = 0.38 - 0.23 * lv;
  const out = [];
  if (rand(w) < pRest) { const k = pickKind(w, m, lv, REST_KINDS); out.push(k); w.recent.push(k); }
  else {
    const p2 = Math.max(0, Math.min(0.65, (m - 120) / 400)), p3 = Math.max(0, Math.min(0.4, (m - 400) / 600));
    let n = 1;
    if (rand(w) < p2) { n = 2; if (rand(w) < p3 / 0.65) n = 3; }
    for (let i = 0; i < n; i++) {
      const k = pickKind(w, m, lv, HAZARD_KINDS);
      out.push(k);
      w.recent.push(k);                                                  // 조합 안에서도 같은 것이 붙지 않게
      if ((w.seen[k] || 0) < 1) break;                                   // 처음 보는 장애물은 혼자서 소개한다
    }
  }
  while (w.recent.length > 4) w.recent.shift();
  for (const k of out) w.seen[k] = (w.seen[k] || 0) + 1;
  return out;
}
function buildChain(w, kinds, x0) {
  const s = w.baseSpeed, obs = [], items = [];
  let cursor = 30;
  kinds.forEach((k, i) => {
    const pr = PRIM[k], half = pr.half(s), c = cursor + half;
    const b = pr.build(c, s, w, x0);
    obs.push(...b.obs); items.push(...b.items);
    cursor = c + half + (i < kinds.length - 1 ? chainGap(s) : 30);
  });
  return { len: cursor, obs, items };
}

function spawnPattern(w) {
  const x0 = (w.viewW || W) + 60;      // 화면 오른쪽 바깥에서 등장
  const m = w.dist / PX_PER_M, lv = Math.min(1, m / 1200);
  let id, built;
  // 회복 물약, 부스터, 자석은 일정 거리마다 따로 끼워 넣는다
  if (w.hp < 55 && w.sincePotion > 1500) {
    built = { len: 240, obs: [], items: [{ t: 'potion', dx: 60, h: 46 }, ...line(110, 4, 28)] };
    w.sincePotion = 0; id = 'potion';
  } else if (m >= w.nextBoostM) {
    built = { len: 300, obs: [], items: [{ t: 'boost', dx: 60, h: 50 }, ...line(120, 5, 28)] };
    w.nextBoostM = m + 650 + rand(w) * 300; id = 'boost';
  } else if (m >= w.nextMagnetM) {
    built = { len: 300, obs: [], items: [{ t: 'magnet', dx: 60, h: 50 }, ...line(120, 5, 28)] };
    w.nextMagnetM = m + 450 + rand(w) * 250; id = 'magnet';
  } else {
    const kinds = composeKinds(w, m, lv);
    built = buildChain(w, kinds, x0);
    id = kinds.join('+');
  }
  const sk = Math.floor(m / 400) % 3;                                    // 구역에 따라 장애물 모양(색)이 달라진다
  for (const o of built.obs) w.obs.push({ ...o, x: x0 + o.dx, id: w.nextId++, sk });
  for (const it of built.items) w.items.push({ ...it, x: x0 + it.dx, y: GROUND - it.h, id: w.nextId++ });
  w.spawnIn = built.len + spawnGap(w.baseSpeed);
  w.lastPattern = id;
  w.sincePotion += built.len;
}

// ---------- World ----------
function newWorld(seed = 1) {
  return {
    seed, viewW: W, t: 0, dist: 0, baseSpeed: SPEED0, speed: SPEED0, state: 'play', hp: HP_MAX,
    ck: { y: GROUND, vy: 0, onGround: true, jumps: 0, sliding: false, inv: 0, anim: 0, coyote: 0, buf: 0, cut: false, jumpHeld: false },
    obs: [], items: [], nextId: 1, spawnIn: 260,
    jellyScore: 0, jellies: 0, bonus: 0,
    boostT: 0, magnetT: 0, slowT: 0,
    sincePotion: 0, nextBoostM: 400, nextMagnetM: 250, lastPattern: '', recent: [], seen: {},
    hits: 0, falls: 0, smashes: 0, events: [],
  };
}
const meters = (w) => Math.floor(w.dist / PX_PER_M);
const scoreOf = (w) => w.jellyScore + w.bonus + meters(w);

function overPit(w) {
  for (const o of w.obs) if (o.t === 'pit' && !o.covered && CX > o.x && CX < o.x + o.w) return o;
  return null;
}
// 쿠키 발밑의 받침: 바닥(구덩이 위가 아니면)과 발판. 발판은 위에서 내려올 때만 받쳐 준다(아래에서 뛰어오를 땐 통과).
function supportY(w, feetY) {
  let best = overPit(w) ? Infinity : GROUND;
  for (const o of w.obs) {
    if (o.t !== 'platform' || CX <= o.x || CX >= o.x + o.w) continue;
    const top = GROUND - o.h;
    if (feetY <= top + 6 && top < best) best = top;
  }
  return best;
}
// 박쥐의 중심 높이(발 기준)
const batHeight = (w, o) => BAT_BASE + BAT_AMP * Math.sin(o.ph + w.t * BAT_OM);

function cookieBox(ck) {
  const h = ck.sliding ? SLIDE_H : STAND_H;
  return { l: CX - HALF_W + 2, r: CX + HALF_W - 2, t: ck.y - h + 4, b: ck.y - 3 };
}
function obsBoxes(o, w) {
  switch (o.t) {
    case 'spike': return [{ l: o.x + o.w * 0.18, r: o.x + o.w * 0.82, t: GROUND - o.h * 0.8, b: GROUND }];
    case 'thorn': return [{ l: o.x + o.w * 0.2, r: o.x + o.w * 0.8, t: GROUND - o.h * 0.94, b: GROUND }];
    case 'wall': return [{ l: o.x + 3, r: o.x + o.w - 3, t: GROUND - o.h, b: GROUND }];
    case 'ball': return [{ l: o.x + 5, r: o.x + o.w - 5, t: GROUND - 30, b: GROUND }];
    case 'bat': { const yc = GROUND - batHeight(w, o); return [{ l: o.x + 8, r: o.x + o.w - 8, t: yc - 13, b: yc + 13 }]; }
    case 'hang': return [{ l: o.x, r: o.x + o.w, t: -50, b: GROUND - HANG_CLEAR }];
    default: return [];
  }
}
const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

const ev = (w, type, extra) => w.events.push({ type, ...extra });

function damage(w, amount, type) {
  const ck = w.ck;
  w.hp -= amount; ck.inv = INV_T; w.slowT = 0.7;
  ev(w, type);
}

// inp: { jump: bool(눌린 순간, 처리하면 false 로), jumpHeld, slide }
function stepWorld(w, dt, inp) {
  if (w.state !== 'play') return;
  const ck = w.ck;
  w.t += dt;

  // 속도
  w.baseSpeed = Math.min(SPEED_MAX, SPEED0 + ACCEL * w.t);
  if (w.slowT > 0) w.slowT = Math.max(0, w.slowT - dt);
  const slowMul = 1 - 0.4 * (w.slowT / 0.7);
  w.speed = w.baseSpeed * (w.boostT > 0 ? BOOST_MUL : 1) * slowMul;
  const dx = w.speed * dt;
  w.dist += dx;
  for (const o of w.obs) { o.x -= dx; if (o.vx) o.x -= o.vx * dt; }       // 박쥐·사탕공은 세상보다 더 빨리 다가온다
  for (const it of w.items) it.x -= dx;
  w.obs = w.obs.filter((o) => o.x + (o.w || 60) > -80);
  w.spawnIn -= dx;
  if (w.spawnIn <= 0) spawnPattern(w);

  // 타이머
  if (ck.inv > 0) ck.inv = Math.max(0, ck.inv - dt);
  if (w.magnetT > 0) w.magnetT = Math.max(0, w.magnetT - dt);
  if (w.boostT > 0) { w.boostT = Math.max(0, w.boostT - dt); if (!w.boostT) { ck.inv = Math.max(ck.inv, 1.6); ck.vy = 0; ck.jumps = 1; ck.onGround = false; } }
  else w.hp -= (DRAIN0 + (DRAIN1 - DRAIN0) * Math.min(1, w.t / 240)) * dt;
  ck.anim += dt * (w.speed / 380);

  // 쿠키
  if (w.boostT > 0) {
    ck.y += (GROUND - 95 - ck.y) * Math.min(1, dt * 7);
    ck.vy = 0; ck.sliding = false; ck.onGround = false;
  } else {
    if (inp.jump) {
      inp.jump = false;
      if (ck.onGround || ck.coyote > 0) { ck.vy = -JUMP_V; ck.onGround = false; ck.jumps = 1; ck.coyote = 0; ck.cut = false; ev(w, 'jump'); }
      else if (ck.jumps < 2) { ck.vy = -JUMP2_V; ck.jumps = 2; ck.cut = false; ev(w, 'djump'); }
      else ck.buf = JUMP_BUF;
    }
    if (ck.buf > 0) ck.buf -= dt;
    if (ck.coyote > 0) ck.coyote -= dt;
    // 점프 버튼을 일찍 떼면 낮은 점프
    if (!inp.jumpHeld && !ck.cut && ck.vy < -CUT_V) { ck.vy = -CUT_V; ck.cut = true; }
    ck.sliding = !!inp.slide && ck.onGround;
    if (inp.slide && !ck.onGround && ck.vy > -200) ck.vy = Math.max(ck.vy, FAST_FALL);

    if (ck.onGround) {
      // 발밑이 사라지면(구덩이, 발판 끝) 떨어지기 시작한다
      if (supportY(w, ck.y) > ck.y + 0.5) { ck.onGround = false; ck.jumps = Math.max(ck.jumps, 1); ck.coyote = COYOTE; }
    }
    if (!ck.onGround) {
      const prevY = ck.y;
      ck.vy += GRAV * dt;
      ck.y += ck.vy * dt;
      if (ck.vy >= 0) {
        const sup = supportY(w, prevY);
        if (ck.y >= sup) {
          ck.y = sup; ck.vy = 0; ck.onGround = true; ck.jumps = 0; ev(w, 'land');
          if (ck.buf > 0) { ck.buf = 0; inp.jump = true; }
        }
      }
      if (ck.y > GROUND + 110) {
        // 구덩이에 빠짐: 체력을 잃고 위에서 다시 나타난다. 그 구덩이는 메워진다.
        const p = overPit(w); if (p) p.covered = true;
        w.falls++; damage(w, FALL_DMG, 'fall');
        ck.y = GROUND - 170; ck.vy = 0; ck.jumps = 1; ck.onGround = false;
      }
    }
    // 스프링: 위를 지나가면 높이 튀어 오른다 (뛰어서 넘으면 안 밟는다)
    for (const o of w.obs) {
      if (o.t === 'spring' && !o.used && ck.y >= GROUND - 14 && ck.vy >= 0 && Math.abs(o.x + o.w / 2 - CX) < 22) {
        o.used = true; o.usedT = w.t; ck.vy = -SPRING_V; ck.onGround = false; ck.jumps = 1; ck.cut = true; ev(w, 'spring');
      }
    }
  }

  // 부딪힘
  const box = cookieBox(ck);
  for (const o of w.obs) {
    if (o.smashed) continue;
    for (const b of obsBoxes(o, w)) {
      if (!hit(box, b)) continue;
      if (w.boostT > 0) { o.smashed = true; w.bonus += 15; w.smashes++; ev(w, 'smash', { x: o.x, w: o.w, t: o.t }); }
      else if (ck.inv <= 0) { w.hits++; damage(w, HIT_DMG, 'hit'); }
      break;
    }
  }
  w.obs = w.obs.filter((o) => !o.smashed);

  // 아이템
  const cy = ck.y - (ck.sliding ? 12 : 26);
  // 젤리는 쿠키가 가까이 지나가면 살짝 빨려 든다: 점프 타이밍이 조금 어긋나도 곡선을 따라 먹을 수 있게 (자석·부스터는 더 넓게)
  const pullR = w.boostT > 0 ? 300 : w.magnetT > 0 ? 230 : SNAP_R;
  for (const it of w.items) {
    if (pullR && it.t === 'jelly') {
      const ddx = CX - it.x, ddy = cy - it.y, d = Math.hypot(ddx, ddy);
      if (d < pullR) { const s = Math.min(d, 1100 * dt); it.x += ddx / d * s; it.y += ddy / d * s; }
    }
    const r = it.t === 'jelly' ? (it.big ? 18 : 12) : 18;
    if (Math.hypot(it.x - CX, it.y - cy) < r + 20) {
      it.got = true;
      if (it.t === 'jelly') { w.jellyScore += it.v; w.jellies++; ev(w, 'jelly', { x: it.x, y: it.y, c: it.c, big: it.big }); }
      else if (it.t === 'potion') { w.hp = Math.min(HP_MAX, w.hp + POTION_HP); ev(w, 'potion', { x: it.x, y: it.y }); }
      else if (it.t === 'boost') { w.boostT = BOOST_T; ck.inv = Math.max(ck.inv, BOOST_T + 1.6); ev(w, 'boost', { x: it.x, y: it.y }); }
      else if (it.t === 'magnet') { w.magnetT = MAGNET_T; ev(w, 'magnet', { x: it.x, y: it.y }); }
    }
  }
  w.items = w.items.filter((it) => !it.got && it.x > -60);

  if (w.hp <= 0) { w.hp = 0; w.state = 'dead'; ev(w, 'dead'); }
}

if (typeof document === 'undefined') {
  module.exports = {
    W, H, GROUND, CX, PX_PER_M, JUMP_V, JUMP2_V, GRAV, SPEED0, SPEED_MAX, HP_MAX, PRIM, KIND_INFO, FAVOR, PATH1, PATH2, PATH_SPRING, halfSpan,
    composeKinds, buildChain, pickKind, supportY, batHeight, SPRING_V, BALL_VX, BAT_VX,
    newWorld, stepWorld, meters, scoreOf, spawnPattern, overPit, cookieBox, obsBoxes, gapFor,
  };
} else {
// ---------- Canvas ----------
let VW = W;                         // 지금 화면의 가로 논리 크기
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const INK = '#2b1d52';

// 폰(터치)에서는 항상 가로 화면으로 논다. 세로로 들고 있으면 게임 화면을 옆으로 눕혀서 채운다
// (폰을 옆으로 돌리면 자동으로 원래 방향이 된다). 화면 조작 버튼은 게임 화면 양쪽 끝에 놓인다.
function layout() {
  const touch = document.body.classList.contains('touch');
  const rot = touch && innerHeight > innerWidth;
  const st = $('stage');
  document.body.classList.toggle('rot', rot);
  st.removeAttribute('style');
  if (rot) {
    Object.assign(st.style, {
      position: 'fixed', left: '0', top: '0', width: innerHeight + 'px', height: innerWidth + 'px',
      transformOrigin: '0 0', transform: `translateX(${innerWidth}px) rotate(90deg)`,
    });
  }
  const LW = rot ? innerHeight : innerWidth, LH = rot ? innerWidth : innerHeight;
  document.body.classList.toggle('compact', LH < 520 || LW < 430);
  return { LW, LH, touch, rot };
}

let SAFE_L = 0, SAFE_R = 0;         // 노치 등으로 가려지는 가장자리 (논리 px)
function fit() {
  const { LW, LH, touch, rot } = layout();
  const st = $('stage');
  let cssW, cssH, scale;
  if (touch) {
    // 쿠키런처럼 화면 전체를 쓴다: 높이에 맞추고, 가로가 더 길면 더 넓게 보여 준다 (너무 넓으면 가운데 정렬)
    VW = Math.max(W, Math.min(1100, Math.round(H * LW / LH)));
    scale = Math.min(LW / VW, LH / H);
    cssW = Math.floor(VW * scale); cssH = Math.floor(H * scale);
    const dirt = (H - GROUND) * scale;                                   // 바닥 흙 띠 높이(px): 버튼은 그 안에 들어간다
    const btnH = Math.round(Math.max(58, Math.min(100, dirt - 16)));
    st.style.setProperty('--btnH', btnH + 'px');
    st.style.setProperty('--btnW', Math.round(Math.max(110, Math.min(190, LW * 0.2))) + 'px');
    st.style.setProperty('--padB', Math.round(Math.max(6, (dirt - btnH) / 2)) + 'px');
    // 노치(가로로 든 폰 양옆)에 가려지지 않게 (눕혀서 채우는 세로 상태에서는 해당 없음)
    const probe = $('probe'), cs = getComputedStyle(probe);
    SAFE_L = rot ? 0 : (parseFloat(cs.paddingLeft) || 0) / scale;
    SAFE_R = rot ? 0 : (parseFloat(cs.paddingRight) || 0) / scale;
  } else {
    VW = W; SAFE_L = SAFE_R = 0;
    const hudH = document.body.classList.contains('compact') ? 46 : 58;
    scale = Math.min((LW - 16) / W, (LH - 16 - hudH) / H);
    cssW = Math.max(240, Math.floor(W * scale)); cssH = Math.floor(H * scale);
  }
  if (world) world.viewW = VW;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / VW, 0, 0, canvas.height / H, 0, 0);
  $('col').style.width = cssW + 'px';
  $('col').style.height = touch ? cssH + 'px' : '';
}
addEventListener('resize', fit);
addEventListener('orientationchange', () => setTimeout(fit, 120));

// ---------- Storage ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let best = Number(store.get('runcookieBest')) || 0;

// ---------- Sound ----------
let audio = null;
let muted = store.get('runcookieMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.1, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'square', vol = 0.06) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
let jellyPitch = 0, lastJelly = 0;
const sfx = {
  jump: () => tone(420, 0.14, 'triangle', 0.09, 260),
  djump: () => tone(560, 0.14, 'triangle', 0.09, 300),
  land: () => tone(140, 0.05, 'sine', 0.05),
  jelly: () => {
    const now = performance.now();
    jellyPitch = now - lastJelly < 260 ? Math.min(jellyPitch + 1, 8) : 0; lastJelly = now;
    tone(700 + jellyPitch * 70, 0.07, 'sine', 0.07);
  },
  hit: () => tone(180, 0.25, 'sawtooth', 0.1, -120),
  fall: () => tone(500, 0.4, 'sine', 0.1, -400),
  potion: () => seq([660, 880, 1100], 60, 'triangle', 0.09),
  boost: () => seq([392, 523, 659, 784, 1047], 60, 'square', 0.06),
  magnet: () => seq([440, 660], 80, 'triangle', 0.09),
  smash: () => tone(260, 0.12, 'square', 0.07, -160),
  spring: () => { tone(260, 0.3, 'sine', 0.1, 700); tone(520, 0.2, 'triangle', 0.06, 500); },
  big: () => seq([880, 1175, 1568], 55, 'triangle', 0.09),
  dead: () => seq([392, 330, 262, 196], 170, 'triangle', 0.1),
};

// ---------- State ----------
let world = null;
let state = 'title';               // title · play · dead · paused
let inp = { jump: false, jumpHeld: false, slide: false };
let particles = [], texts = [];
let shake = 0, uiT = 0, hpFlash = 0;
let lastMeters = 0;

function updateHud() {
  $('score').textContent = world ? scoreOf(world).toLocaleString() : '0';
  $('best').textContent = best.toLocaleString();
}

// 폰에서는 게임을 시작하는 순간 전체화면으로 (사용자가 누른 순간에만 브라우저가 허락한다).
// 가로 고정도 시도한다(안드로이드). 전체화면이 안 되는 아이폰은 로비의 '크게 보기'로 위 막대를 숨긴다.
function enterFull() {
  if (!document.body.classList.contains('touch')) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  const immersive = () => { try { if (window.parent !== window) window.parent.document.getElementById('player').classList.add('immersive'); } catch (_) {} };
  if (!req) { immersive(); return; }
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    Promise.resolve(req.call(el)).then(() => {
      try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => {}); } catch (_) {}
    }).catch(immersive);
  } catch (_) { immersive(); }
}

function startGame() {
  enterFull();
  world = newWorld((Math.random() * 1e9) | 0);
  world.viewW = VW;
  inp = { jump: false, jumpHeld: false, slide: false };
  jumpKeys.clear(); slideKeys.clear(); pointers.clear();
  particles = []; texts = []; shake = 0; lastMeters = 0;
  state = 'play';
  hideOverlay();
  updateHud();
}

function burst(x, y, color, n, spd, up = 60) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = spd * (0.4 + Math.random() * 0.8);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - up, life: 0.4 + Math.random() * 0.3, r: 2 + Math.random() * 3, color });
  }
}
const JELLY_COL = ['#ff7ab6', '#ffd23f', '#5fd47a', '#5ab8ff'];
function floatText(text, x, y, color = '#fff') { texts.push({ text, x, y, t: 0, color }); }

function handleEvents(evs) {
  const ck = world.ck;
  for (const e of evs) {
    if (e.type === 'jump') { sfx.jump(); burst(CX, GROUND, '#fff', 5, 60, 20); }
    else if (e.type === 'djump') { sfx.djump(); burst(CX, ck.y, '#fff8c4', 8, 70, 10); }
    else if (e.type === 'land') { sfx.land(); burst(CX, GROUND, '#fff', 3, 50, 10); }
    else if (e.type === 'jelly') {
      if (e.big) { sfx.big(); burst(e.x, e.y, '#ffd23f', 14, 130, 40); floatText('+50', e.x, e.y - 20, '#ffd23f'); }
      else { sfx.jelly(); burst(e.x, e.y, JELLY_COL[e.c], 4, 70, 30); }
    }
    else if (e.type === 'hit') { sfx.hit(); try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(40); } catch (_) {} shake = 0.3; hpFlash = 0.5; burst(CX, ck.y - 26, '#ff5f7a', 12, 150); floatText('-18', CX, ck.y - 60, '#ff5f7a'); }
    else if (e.type === 'fall') { sfx.fall(); shake = 0.35; hpFlash = 0.5; floatText('-25', CX, GROUND - 160, '#ff5f7a'); }
    else if (e.type === 'potion') { sfx.potion(); burst(e.x, e.y, '#ff7ab6', 12, 110); floatText('+30', CX, ck.y - 60, '#7ee39a'); }
    else if (e.type === 'boost') { sfx.boost(); burst(CX, ck.y - 26, '#ffd23f', 18, 200); floatText('부스터!', VW / 2, 150, '#ffd23f'); }
    else if (e.type === 'magnet') { sfx.magnet(); floatText('자석!', VW / 2, 150, '#5ab8ff'); }
    else if (e.type === 'spring') { sfx.spring(); burst(CX, GROUND, '#5ab8ff', 10, 120, 80); floatText('슝~!', CX + 40, ck.y - 60, '#5ab8ff'); }
    else if (e.type === 'smash') { sfx.smash(); burst(e.x + (e.w || 40) / 2, GROUND - 30, '#ffb3d9', 14, 200); shake = 0.15; }
    else if (e.type === 'dead') { sfx.dead(); onDead(); }
  }
}

function onDead() {
  state = 'dead';
  const score = scoreOf(world);
  const fresh = score > best;
  if (fresh) { best = score; store.set('runcookieBest', String(best)); }
  updateHud();
  setTimeout(() => {
    if (state !== 'dead') return;
    showOverlay(`
      <h2>지쳐서 쓰러졌어요 😵</h2>
      <div class="big">${score.toLocaleString()}<small>점</small></div>
      ${fresh ? '<p class="badge good">🏆 최고 기록!</p>' : `<p>최고 기록 ${best.toLocaleString()}점</p>`}
      <p class="stats">🏃 ${meters(world).toLocaleString()}m · 🍬 젤리 ${world.jellies}개</p>
      <button id="startBtn">다시 달리기</button>`);
    $('startBtn').onclick = startGame;
  }, 900);
}

// ---------- Overlay ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.scrollTop = 0; }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function showTitle() {
  state = 'title';
  showOverlay(`
    <h1>달려라<br>쿠키</h1>
    <p>오븐에서 도망친 쿠키가 <b>젤리를 먹으며</b> 끝없이 달려요.<br>장애물을 피하고 <b>체력이 다 닳기 전에</b> 최대한 멀리!</p>
    <button id="startBtn">달리기 시작!</button>
    <div class="help">
      ⌨️ Space·↑ 점프 (한 번 더 누르면 2단 점프) · ↓ 슬라이드<br>
      📱 오른쪽 버튼 점프 · 왼쪽 버튼 슬라이드<br>
      🍬 젤리 · 🧪 물약(체력) · ⚡ 부스터(장애물 박살) · 🧲 자석<br>
      🦇 박쥐는 슬라이드 · 🧱 높은 벽은 2단 점프 · 🟦 스프링·발판으로 높이!
    </div>`);
  $('startBtn').onclick = startGame;
}
function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay(`<h2>일시정지</h2><button id="startBtn">계속하기</button>`);
  $('startBtn').onclick = resume;
}
function resume() { if (state !== 'paused') return; state = 'play'; hideOverlay(); }

// ---------- Palette ----------
const BIOMES = [
  { sky: ['#8fd3ff', '#ffe3f4'], hill: '#ffc0e0', far: '#ffd9ee', ground: '#e8a457', groundDark: '#c47f35', frost: '#ffffff', frost2: '#ff8fbf', name: '사탕 나라' },
  { sky: ['#ffd9a8', '#ffb3b3'], hill: '#c98a5c', far: '#e6b48c', ground: '#8a5a3a', groundDark: '#5e3a22', frost: '#f3e2c7', frost2: '#c98a5c', name: '초코 숲' },
  { sky: ['#2a1f5c', '#6a4aa8'], hill: '#4a3a8a', far: '#5b4aa0', ground: '#5a4a9a', groundDark: '#3a2e70', frost: '#c9b8ff', frost2: '#8f7be8', name: '별밤 정원' },
];
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const lerpC = (a, b, k) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`; };
function biomeAt(m) {
  const seg = m / 400, i = Math.floor(seg) % 3, j = (i + 1) % 3;
  const k = Math.max(0, (seg - Math.floor(seg) - 0.88) / 0.12);   // 구역 끝에서 부드럽게 다음 색으로
  return { a: BIOMES[i], b: BIOMES[j], k, i };
}
const mix = (bi, key) => (Array.isArray(bi.a[key]) ? bi.a[key].map((c, n) => lerpC(c, bi.b[key][n], bi.k)) : lerpC(bi.a[key], bi.b[key], bi.k));

// ---------- Drawing ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground(w, bi) {
  const [s0, s1] = mix(bi, 'sky');
  const g = ctx.createLinearGradient(0, 0, 0, GROUND);
  g.addColorStop(0, s0); g.addColorStop(1, s1);
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, H);
  const d = w ? w.dist : uiT * 200;
  if (bi.i === 2 || (bi.i === 1 && bi.k > 0)) {
    ctx.fillStyle = `rgba(255,255,255,${bi.i === 2 ? 0.9 - bi.k * 0.9 : bi.k * 0.9})`;
    for (let i = 0; i < 26; i++) { const x = ((i * 137 - d * 0.03) % VW + VW) % VW, y = (i * 61) % 200 + 8; ctx.fillRect(x, y, 2 + (i % 3), 2 + (i % 3)); }
  }
  // 구름
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (let i = 0; i < 5; i++) {
    const x = ((i * 190 - d * 0.06) % (VW + 200) + VW + 200) % (VW + 200) - 100, y = 40 + (i * 47) % 90;
    ctx.beginPath(); ctx.arc(x, y, 22, 0, 7); ctx.arc(x + 24, y + 4, 18, 0, 7); ctx.arc(x - 22, y + 6, 15, 0, 7); ctx.fill();
  }
  // 먼 언덕
  ctx.fillStyle = mix(bi, 'far');
  ctx.beginPath(); ctx.moveTo(0, GROUND);
  for (let x = 0; x <= VW; x += 20) ctx.lineTo(x, GROUND - 70 - Math.sin((x + d * 0.1) / 90) * 26 - Math.sin((x + d * 0.1) / 37) * 8);
  ctx.lineTo(VW, GROUND); ctx.fill();
  ctx.fillStyle = mix(bi, 'hill');
  ctx.beginPath(); ctx.moveTo(0, GROUND);
  for (let x = 0; x <= VW; x += 20) ctx.lineTo(x, GROUND - 34 - Math.sin((x + d * 0.25) / 60) * 16);
  ctx.lineTo(VW, GROUND); ctx.fill();
  // 중간 장식: 막대사탕 나무 / 컵케이크 / 달 사탕
  const step = 210;
  for (let i = -1; i < VW / step + 2; i++) {
    const idx = Math.floor((d * 0.45) / step) + i;
    const x = idx * step - d * 0.45 + 60 + ((idx * 53) % 70);
    const kind = ((idx % 3) + 3) % 3;
    const y = GROUND - 8;
    ctx.lineWidth = 3; ctx.strokeStyle = INK;
    if (kind === 0) {
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 3, y - 60, 6, 60); ctx.strokeRect(x - 3, y - 60, 6, 60);
      ctx.fillStyle = ['#ff7ab6', '#5ab8ff', '#ffd23f'][((idx % 3) + 3) % 3];
      ctx.beginPath(); ctx.arc(x, y - 70, 20, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y - 70, 11, 0, 5); ctx.stroke();
    } else if (kind === 1) {
      ctx.fillStyle = '#ffd9a0'; ctx.beginPath(); ctx.moveTo(x - 20, y - 26); ctx.lineTo(x + 20, y - 26); ctx.lineTo(x + 14, y); ctx.lineTo(x - 14, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ff9ecb'; ctx.beginPath(); ctx.arc(x, y - 34, 22, Math.PI, 0); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8203a'; ctx.beginPath(); ctx.arc(x, y - 58, 6, 0, 7); ctx.fill(); ctx.stroke();
    } else {
      ctx.fillStyle = '#c9f7d2'; ctx.beginPath(); ctx.arc(x, y - 30, 30, Math.PI, 0); ctx.lineTo(x + 30, y); ctx.lineTo(x - 30, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5fd47a'; ctx.beginPath(); ctx.arc(x - 10, y - 30, 5, 0, 7); ctx.arc(x + 12, y - 22, 4, 0, 7); ctx.fill();
    }
  }
}

function drawGround(w, bi) {
  const pits = w ? w.obs.filter((o) => o.t === 'pit' && !o.covered).sort((a, b) => a.x - b.x) : [];
  const segs = []; let x = 0;
  for (const p of pits) { if (p.x > x) segs.push([x, p.x]); x = Math.max(x, p.x + p.w); }
  segs.push([x, VW]);
  const d = w ? w.dist : uiT * 200;
  for (const [a, b] of segs) {
    if (b <= a) continue;
    ctx.fillStyle = mix(bi, 'ground'); ctx.fillRect(a, GROUND, b - a, H - GROUND);
    ctx.fillStyle = mix(bi, 'groundDark'); ctx.fillRect(a, GROUND + 40, b - a, H - GROUND - 40);
    // 비스킷 무늬
    ctx.fillStyle = 'rgba(0,0,0,.12)';
    for (let gx = -((d * 1) % 60); gx < VW; gx += 60) { if (gx + 6 > a && gx < b) { ctx.beginPath(); ctx.arc(gx + 30, GROUND + 26, 3, 0, 7); ctx.arc(gx + 12, GROUND + 60, 3, 0, 7); ctx.fill(); } }
    ctx.strokeStyle = INK; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(a, GROUND + 2); ctx.lineTo(b, GROUND + 2); ctx.stroke();
    // 프로스팅
    ctx.fillStyle = mix(bi, 'frost');
    ctx.beginPath(); ctx.moveTo(a, GROUND);
    for (let fx = a; fx <= b; fx += 6) ctx.lineTo(fx, GROUND + 8 + Math.sin((fx + d) / 14) * 3 + ((Math.floor((fx + d) / 40) % 3) === 0 ? 5 : 0));
    ctx.lineTo(b, GROUND); ctx.closePath(); ctx.fill();
    ctx.fillStyle = mix(bi, 'frost2');
    for (let fx = -((d) % 44); fx < VW; fx += 44) if (fx > a && fx < b) ctx.fillRect(fx, GROUND + 3, 6, 4);
    ctx.strokeRect(a - 2, GROUND, b - a + 4, H - GROUND + 4);
  }
  // 구덩이 안: 우유 바다
  for (const p of pits) {
    const pg = ctx.createLinearGradient(0, GROUND, 0, H); pg.addColorStop(0, '#2b1d52'); pg.addColorStop(1, '#5b3f9a');
    ctx.fillStyle = pg; ctx.fillRect(p.x, GROUND, p.w, H - GROUND);
    ctx.fillStyle = '#f4f8ff'; ctx.fillRect(p.x, GROUND + 60, p.w, H - GROUND - 60);
    ctx.fillStyle = '#dfe9ff';
    ctx.beginPath(); ctx.moveTo(p.x, GROUND + 60);
    for (let fx = 0; fx <= p.w; fx += 8) ctx.lineTo(p.x + fx, GROUND + 60 + Math.sin((fx + uiT * 120) / 10) * 4);
    ctx.lineTo(p.x + p.w, H); ctx.lineTo(p.x, H); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(p.x, GROUND); ctx.lineTo(p.x, H); ctx.moveTo(p.x + p.w, GROUND); ctx.lineTo(p.x + p.w, H); ctx.stroke();
  }
  // 메워진 구덩이는 다리
  if (w) for (const p of w.obs) if (p.t === 'pit' && p.covered) {
    ctx.fillStyle = '#ffd9a0'; ctx.fillRect(p.x, GROUND, p.w, 12); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(p.x, GROUND, p.w, 12);
  }
}

// 구역(sk 0 사탕 나라 · 1 초코 숲 · 2 별밤 정원)마다 장애물의 색과 모양이 달라진다
const SK = {
  spike: [['#e0357f', '#ff4f9a', 'rgba(255,255,255,.85)'], ['#5a2f17', '#7a4423', '#f3e2c7'], ['#22a7cf', '#6fdcff', '#eafcff']],
  cane: [['#fff', '#ff5f7a'], ['#7a4423', '#c98a5c'], ['#e9dcff', '#8f7be8']],
  bar: [['#ffd23f', '#ff9f1c'], ['#c98a5c', '#8a5a3a'], ['#c9b8ff', '#7a5ad6']],
  block: [['#ffc2dc', '#ff7ab6'], ['#8a5a3a', '#5e3a22'], ['#8fe6ff', '#3fa9d8']],
  bat: [['#9b59d0', '#e7ccff'], ['#5e3a22', '#ffb347'], ['#5ad8ff', '#e9fbff']],
  ball: [['#fff', '#ff5f7a'], ['#5e3a22', '#c98a5c'], ['#5ab8ff', '#e9fbff']],
  slab: [['#ffb3d9', '#ff7ab6'], ['#7a4423', '#c98a5c'], ['#a98aff', '#7a5ad6']],
};
const skOf = (o) => o.sk || 0;

function drawSpike(o) {
  const sk = skOf(o), [c0, c1, hi] = SK.spike[sk];
  const n = Math.max(1, Math.round(o.w / 36));
  for (let i = 0; i < n; i++) {
    const x = o.x + (o.w / n) * i, ww = o.w / n;
    ctx.fillStyle = i % 2 ? c0 : c1;
    ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x + ww / 2, GROUND - o.h); ctx.lineTo(x + ww, GROUND); ctx.closePath();
    ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = hi;
    if (sk === 1) { ctx.beginPath(); ctx.moveTo(x + ww / 2, GROUND - o.h); ctx.lineTo(x + ww / 2 + 7, GROUND - o.h + 14); ctx.lineTo(x + ww / 2 - 7, GROUND - o.h + 14); ctx.closePath(); ctx.fill(); }   // 초코 끝의 크림
    else { ctx.beginPath(); ctx.moveTo(x + ww / 2 - 3, GROUND - o.h + 10); ctx.lineTo(x + ww / 2 + 1, GROUND - o.h + 8); ctx.lineTo(x + ww / 2 - 6, GROUND - 12); ctx.closePath(); ctx.fill(); }
    if (sk === 2) { ctx.fillStyle = 'rgba(111,220,255,.25)'; ctx.beginPath(); ctx.arc(x + ww / 2, GROUND - o.h / 2, 26, 0, 7); ctx.fill(); }   // 수정의 빛
  }
}
function drawThorn(o) {
  const sk = skOf(o), [a, b] = SK.cane[sk];
  const x = o.x, y = GROUND - o.h;
  roundRect(x + 4, y, o.w - 8, o.h, 10);
  ctx.fillStyle = a; ctx.fill();
  ctx.save(); roundRect(x + 4, y, o.w - 8, o.h, 10); ctx.clip();
  ctx.fillStyle = b;
  if (sk === 1) { for (let i = 0; i < 6; i++) ctx.fillRect(x, y + i * 16 + 6, o.w, 6); }          // 초코 통나무의 나이테 줄
  else for (let i = -2; i < 8; i++) { ctx.beginPath(); ctx.moveTo(x, y + i * 22); ctx.lineTo(x + o.w, y + i * 22 - 16); ctx.lineTo(x + o.w, y + i * 22 + 2); ctx.lineTo(x, y + i * 22 + 18); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle = INK; ctx.lineWidth = 3; roundRect(x + 4, y, o.w - 8, o.h, 10); ctx.stroke();
  if (sk === 2) { ctx.fillStyle = 'rgba(143,123,232,.25)'; ctx.beginPath(); ctx.arc(x + o.w / 2, y + o.h / 2, 42, 0, 7); ctx.fill(); }
}
function drawHang(o) {
  const sk = skOf(o), [a, b] = SK.bar[sk];
  const by = GROUND - HANG_CLEAR;
  ctx.strokeStyle = INK; ctx.lineWidth = 4;
  for (const fx of [o.x + 16, o.x + o.w - 16]) { ctx.beginPath(); ctx.moveTo(fx, -4); ctx.lineTo(fx, by - 22); ctx.stroke(); }
  roundRect(o.x, by - 26, o.w, 26, 13);
  ctx.fillStyle = a; ctx.fill(); ctx.stroke();
  ctx.save(); roundRect(o.x, by - 26, o.w, 26, 13); ctx.clip();
  ctx.fillStyle = b;
  for (let sx = o.x - 10; sx < o.x + o.w; sx += 30) { ctx.beginPath(); ctx.moveTo(sx, by); ctx.lineTo(sx + 14, by - 26); ctx.lineTo(sx + 26, by - 26); ctx.lineTo(sx + 12, by); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle = INK; roundRect(o.x, by - 26, o.w, 26, 13); ctx.stroke();
  ctx.fillStyle = INK; ctx.font = "bold 13px 'Jua', sans-serif"; ctx.textAlign = 'center'; ctx.fillText('⬇ 슬라이드', o.x + o.w / 2, by - 33);
}
function drawWall(o) {
  const sk = skOf(o), [a, b] = SK.block[sk];
  const n = 5, bh = o.h / n;
  ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  for (let i = 0; i < n; i++) {
    const y = GROUND - (i + 1) * bh;
    roundRect(o.x + 2, y + 1, o.w - 4, bh - 2, 7);
    ctx.fillStyle = i % 2 ? a : b; ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(o.x + 7, y + 6, o.w - 14, 4);
  }
  ctx.fillStyle = INK; ctx.font = "bold 12px 'Jua', sans-serif"; ctx.textAlign = 'center'; ctx.fillText('2단 점프!', o.x + o.w / 2, GROUND - o.h - 10);
  if (sk === 2) { ctx.fillStyle = 'rgba(143,230,255,.22)'; ctx.beginPath(); ctx.arc(o.x + o.w / 2, GROUND - o.h / 2, 70, 0, 7); ctx.fill(); }
}
function drawBat(o, w) {
  const sk = skOf(o), [body, acc] = SK.bat[sk];
  const cx = o.x + o.w / 2, cy = GROUND - batHeight(w, o);
  const flap = Math.sin(uiT * 20 + o.ph) * 0.7;
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = INK;
  for (const d of [-1, 1]) {           // 날개
    ctx.save(); ctx.translate(cx + d * 8, cy - 2); ctx.rotate(d * (-0.5 + flap * 0.6)); ctx.scale(d, 1);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(14, -18, 30, -6); ctx.quadraticCurveTo(24, 0, 28, 8); ctx.quadraticCurveTo(14, 2, 0, 8); ctx.closePath();
    ctx.fillStyle = body; ctx.fill(); ctx.stroke(); ctx.restore();
  }
  ctx.beginPath(); ctx.ellipse(cx, cy, 13, 12, 0, 0, 7); ctx.fillStyle = body; ctx.fill(); ctx.stroke();      // 몸
  ctx.beginPath(); ctx.moveTo(cx - 9, cy - 8); ctx.lineTo(cx - 6, cy - 17); ctx.lineTo(cx - 2, cy - 10); ctx.moveTo(cx + 9, cy - 8); ctx.lineTo(cx + 6, cy - 17); ctx.lineTo(cx + 2, cy - 10); ctx.stroke();   // 귀
  ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(cx - 5, cy - 2, 3.4, 0, 7); ctx.arc(cx + 5, cy - 2, 3.4, 0, 7); ctx.fill();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(cx - 5, cy - 2, 1.5, 0, 7); ctx.arc(cx + 5, cy - 2, 1.5, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(cx - 3, cy + 4, 2, 4); ctx.fillRect(cx + 1, cy + 4, 2, 4);
  if (sk === 2) { ctx.fillStyle = 'rgba(90,216,255,.22)'; ctx.beginPath(); ctx.arc(cx, cy, 34, 0, 7); ctx.fill(); }
}
function drawBall(o) {
  const sk = skOf(o), [a, b] = SK.ball[sk];
  const r = 17, cx = o.x + r, cy = GROUND - r;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(o.x / r);       // 굴러가며 돈다
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = INK;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fillStyle = a; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.clip();
  ctx.fillStyle = b;
  if (sk === 1) { for (const [x, y] of [[-6, -6], [6, -3], [-2, 7], [8, 8], [-10, 4]]) { ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill(); } }   // 초코볼 알갱이
  else for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r + 4, i * Math.PI / 2, i * Math.PI / 2 + 0.8); ctx.closePath(); ctx.fill(); }   // 페퍼민트 소용돌이
  ctx.restore();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.ellipse(cx - 6, cy - 7, 3, 5, 0.6, 0, 7); ctx.fill();
  if (sk === 2) { ctx.fillStyle = 'rgba(90,184,255,.22)'; ctx.beginPath(); ctx.arc(cx, cy, 30, 0, 7); ctx.fill(); }
  // 굴러오는 방향 표시
  ctx.strokeStyle = 'rgba(43,29,82,.35)'; ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(o.x + o.w + 10 + i * 14, cy - 6 + i * 6); ctx.lineTo(o.x + o.w + 26 + i * 14, cy - 6 + i * 6); ctx.stroke(); }
}
function drawPlatform(o) {
  const sk = skOf(o), [a, b] = SK.slab[sk];
  const y = GROUND - o.h;
  ctx.fillStyle = 'rgba(43,29,82,.18)'; ctx.fillRect(o.x + 6, GROUND - 4, o.w - 12, 4);          // 바닥의 그림자
  ctx.lineJoin = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  roundRect(o.x, y, o.w, 18, 8); ctx.fillStyle = a; ctx.fill(); ctx.stroke();
  ctx.save(); roundRect(o.x, y, o.w, 18, 8); ctx.clip();
  ctx.fillStyle = b; ctx.fillRect(o.x, y + 10, o.w, 8);
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(o.x, y, o.w, 5);
  for (let gx = o.x + 14; gx < o.x + o.w - 6; gx += 28) { ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(gx, y + 9, 6, 3); }
  ctx.restore();
  ctx.strokeStyle = INK; roundRect(o.x, y, o.w, 18, 8); ctx.stroke();
  if (sk === 2) { ctx.fillStyle = 'rgba(169,138,255,.2)'; ctx.fillRect(o.x - 6, y - 8, o.w + 12, 34); }
}
function drawSpring(o) {
  const cx = o.x + o.w / 2;
  const k = o.used ? Math.max(0, 1 - (uiT - (o.usedUi || (o.usedUi = uiT))) * 3) : 0;     // 밟은 직후 잠깐 길게 늘어난다
  const up = 12 + k * 18;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(cx - 10, GROUND); for (let i = 0; i < 5; i++) { ctx.lineTo(cx + (i % 2 ? -10 : 10), GROUND - (i + 1) * up / 5); } ctx.stroke();
  ctx.strokeStyle = '#c9d3e8'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(cx - 10, GROUND); for (let i = 0; i < 5; i++) { ctx.lineTo(cx + (i % 2 ? -10 : 10), GROUND - (i + 1) * up / 5); } ctx.stroke();
  roundRect(cx - 19, GROUND - up - 9, 38, 10, 5); ctx.fillStyle = '#5ab8ff'; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(cx - 13, GROUND - up - 7, 14, 3);
  if (!o.used) { ctx.fillStyle = INK; ctx.font = "bold 12px 'Jua', sans-serif"; ctx.textAlign = 'center'; ctx.fillText('⬆ 밟기', cx, GROUND - up - 16 + Math.sin(uiT * 6) * 2); }
}

function drawJelly(it, t) {
  const big = !!it.big, k = big ? 1.6 : 1;
  const r = 11 * k, bob = Math.sin(t * 5 + it.x * 0.05) * 2;
  const x = it.x, y = it.y + bob;
  if (big) { ctx.fillStyle = 'rgba(255,210,63,.35)'; ctx.beginPath(); ctx.arc(x, y, 30 + Math.sin(t * 7) * 2, 0, 7); ctx.fill(); }
  ctx.fillStyle = big ? '#ffd23f' : JELLY_COL[it.c]; ctx.strokeStyle = INK; ctx.lineWidth = 2.5 + (big ? 0.8 : 0); ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.arc(x - 6 * k, y - 8 * k, 4.5 * k, 0, 7); ctx.arc(x + 6 * k, y - 8 * k, 4.5 * k, 0, 7); ctx.fill(); ctx.stroke();
  roundRect(x - r, y - r + 2 * k, r * 2, r * 2 - 2 * k, 8 * k); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.beginPath(); ctx.ellipse(x - 4 * k, y - 2 * k, 3 * k, 5 * k, 0.4, 0, 7); ctx.fill();
  ctx.fillStyle = INK; ctx.fillRect(x + 1 * k, y + 2 * k, 2.5 * k, 2.5 * k); ctx.fillRect(x + 6 * k, y + 2 * k, 2.5 * k, 2.5 * k);
  if (big) { ctx.fillStyle = '#fff'; ctx.font = "bold 11px 'Jua', sans-serif"; ctx.textAlign = 'center'; ctx.fillText('★', x, y - r - 6); }
}
function drawPickup(it, t) {
  const bob = Math.sin(t * 4 + it.x * 0.03) * 3, x = it.x, y = it.y + bob;
  ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = INK;
  const glow = { potion: '#ff7ab6', boost: '#ffd23f', magnet: '#5ab8ff' }[it.t];
  ctx.fillStyle = glow + '55'; ctx.beginPath(); ctx.arc(x, y, 24 + Math.sin(t * 6) * 2, 0, 7); ctx.fill();
  if (it.t === 'potion') {
    roundRect(x - 11, y - 4, 22, 20, 8); ctx.fillStyle = '#ff5f7a'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 5, y - 14, 10, 11); ctx.strokeRect(x - 5, y - 14, 10, 11);
    ctx.fillStyle = '#fff'; ctx.font = "bold 14px 'Jua', sans-serif"; ctx.textAlign = 'center'; ctx.fillText('+', x, y + 11);
  } else if (it.t === 'boost') {
    ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(x, y, 17, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x + 3, y - 12); ctx.lineTo(x - 8, y + 2); ctx.lineTo(x - 1, y + 2); ctx.lineTo(x - 4, y + 12); ctx.lineTo(x + 8, y - 3); ctx.lineTo(x + 1, y - 3); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillStyle = '#5ab8ff'; ctx.beginPath(); ctx.arc(x, y, 17, 0, 7); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 6; ctx.strokeStyle = '#ff5f7a'; ctx.beginPath(); ctx.arc(x, y + 2, 8, Math.PI, 0); ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.beginPath(); ctx.arc(x, y + 2, 11, Math.PI, 0); ctx.arc(x, y + 2, 5, 0, Math.PI, true); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 11, y + 2, 6, 6); ctx.fillRect(x + 5, y + 2, 6, 6);
  }
}

function drawCookie(w, t) {
  const ck = w.ck;
  if (ck.inv > 0 && w.boostT <= 0 && Math.floor(ck.inv * 14) % 2) return;   // 깜빡임
  const boost = w.boostT > 0, s = boost ? 1.35 : 1;
  const run = ck.anim * 7;
  ctx.save();
  ctx.translate(CX, ck.y);
  ctx.scale(s, s);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (boost) {
    ctx.fillStyle = 'rgba(255,210,63,.35)'; ctx.beginPath(); ctx.arc(0, -26, 44 + Math.sin(t * 20) * 3, 0, 7); ctx.fill();
  }
  const air = !ck.onGround && !boost;
  const sl = ck.sliding;
  // 다리
  ctx.strokeStyle = INK; ctx.lineWidth = 5;
  const leg = (a) => { ctx.beginPath(); ctx.moveTo(sl ? -6 : a * 0, sl ? -8 : -10); ctx.lineTo(sl ? -22 : Math.sin(run + a) * 9 * (air ? 0.3 : 1) + (air ? a * 4 : 0), sl ? -3 : -1 - (air ? 3 : 0)); ctx.stroke(); };
  if (sl) { leg(0); ctx.beginPath(); ctx.moveTo(4, -8); ctx.lineTo(-14, -1); ctx.stroke(); }
  else { leg(0); leg(Math.PI); }
  ctx.strokeStyle = '#8a4b1f'; ctx.lineWidth = 2.5;
  if (sl) { ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(-22, -3); ctx.moveTo(4, -8); ctx.lineTo(-14, -1); ctx.stroke(); }
  else for (const a of [0, Math.PI]) { ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(Math.sin(run + a) * 9 * (air ? 0.3 : 1) + (air ? a * 4 : 0), -1 - (air ? 3 : 0)); ctx.stroke(); }
  // 몸 (쿠키)
  ctx.translate(0, sl ? -14 : -28 + (ck.onGround ? Math.abs(Math.sin(run)) * -1.5 : 0));
  if (sl) ctx.scale(1.25, 0.72);
  if (air) ctx.rotate(Math.max(-0.35, Math.min(0.5, ck.vy / 2600)));
  ctx.fillStyle = '#f4b860'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, r = 23 + (i % 2 ? 0 : 1.4); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#7a4320';
  for (const [cx2, cy2, r] of [[-11, -12, 3.2], [10, -14, 2.8], [-14, 6, 2.6], [12, 8, 3.2], [1, 14, 2.4]]) { ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, 7); ctx.fill(); }
  // 얼굴
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(-3, -3, 2.8, 0, 7); ctx.arc(9, -3, 2.8, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(-4, -4.5, 1.6, 1.6); ctx.fillRect(8, -4.5, 1.6, 1.6);
  ctx.fillStyle = '#ff8fa8'; ctx.beginPath(); ctx.ellipse(-8, 3, 3.5, 2, 0, 0, 7); ctx.ellipse(13, 3, 3.5, 2, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath();
  if (w.hp < 25) { ctx.moveTo(1, 8); ctx.quadraticCurveTo(4, 4, 7, 8); } else { ctx.moveTo(1, 5); ctx.quadraticCurveTo(4, 9, 7, 5); }
  ctx.stroke();
  // 목도리
  ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-14, 15); ctx.quadraticCurveTo(0, 21, 14, 14); ctx.stroke();
  ctx.strokeStyle = '#ff5f7a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-14, 15); ctx.quadraticCurveTo(0, 21, 14, 14); ctx.stroke();
  const wag = Math.sin(run * 1.2) * 4;
  ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(-13, 15); ctx.lineTo(-30, 12 + wag); ctx.stroke();
  ctx.strokeStyle = '#ff5f7a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-13, 15); ctx.lineTo(-30, 12 + wag); ctx.stroke();
  ctx.restore();
}

function drawHud(w) {
  const full = document.body.classList.contains('touch');
  // 체력 막대
  const x = 16 + SAFE_L, y = 14, bw = 210, bh = 16, k = w.hp / HP_MAX;
  ctx.fillStyle = '#ff5f7a'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x + 4, y + bh / 2, 13, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.font = "bold 14px 'Jua', sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('♥', x + 4, y + bh / 2 + 1);
  const bx = x + 20;
  roundRect(bx, y, bw, bh, 8); ctx.fillStyle = 'rgba(43,29,82,.55)'; ctx.fill();
  if (k > 0) {
    roundRect(bx + 2, y + 2, Math.max(8, (bw - 4) * k), bh - 4, 6);
    ctx.fillStyle = k > 0.5 ? '#7ee39a' : k > 0.25 ? '#ffd23f' : '#ff5f7a';
    if (hpFlash > 0 && Math.floor(hpFlash * 20) % 2) ctx.fillStyle = '#fff';
    ctx.fill();
  }
  roundRect(bx, y, bw, bh, 8); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke();
  ctx.lineJoin = 'round';
  if (full) {
    // 폰 전체화면: 점수판 알약이 없으니 점수와 최고 기록을 위쪽 가운데에 그린다
    ctx.textAlign = 'center';
    ctx.font = "30px 'Jua', sans-serif"; ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.fillStyle = '#ffd23f';
    const sc = scoreOf(w).toLocaleString();
    ctx.strokeText(sc, VW / 2, 30); ctx.fillText(sc, VW / 2, 30);
    ctx.font = "13px 'Jua', sans-serif"; ctx.lineWidth = 4; ctx.fillStyle = '#fff';
    const bt = `BEST ${best.toLocaleString()}`;
    ctx.strokeText(bt, VW / 2, 52); ctx.fillText(bt, VW / 2, 52);
  }
  // 거리와 젤리 (폰에서는 오른쪽 위 일시정지·소리 버튼 왼쪽에)
  const rx = VW - 14 - SAFE_R - (full ? 92 : 0);
  ctx.textAlign = 'right'; ctx.font = "20px 'Jua', sans-serif";
  ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.fillStyle = '#fff';
  const t1 = `${meters(w).toLocaleString()}m`;
  ctx.strokeText(t1, rx, 24); ctx.fillText(t1, rx, 24);
  ctx.font = "15px 'Jua', sans-serif"; ctx.fillStyle = '#ffd23f';
  const t2 = `🍬 ${w.jellies}`;
  ctx.strokeText(t2, rx, 46); ctx.fillText(t2, rx, 46);
  // 효과 타이머
  let ex = 16 + SAFE_L;
  const badge = (label, col, t, max) => {
    roundRect(ex, 40, 64, 18, 9); ctx.fillStyle = 'rgba(43,29,82,.6)'; ctx.fill();
    roundRect(ex + 2, 42, Math.max(6, 60 * t / max), 14, 7); ctx.fillStyle = col; ctx.fill();
    ctx.fillStyle = INK; ctx.font = "12px 'Jua', sans-serif"; ctx.textAlign = 'left'; ctx.fillText(label, ex + 8, 50);
    ex += 70;
  };
  if (w.boostT > 0) badge('⚡부스터', '#ffd23f', w.boostT, BOOST_T);
  if (w.magnetT > 0) badge('🧲자석', '#5ab8ff', w.magnetT, MAGNET_T);
}

function drawScene(w, dt) {
  const bi = biomeAt(w ? meters(w) : 0);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 26, (Math.random() - 0.5) * shake * 26);
  drawBackground(w, bi);
  drawGround(w, bi);
  if (w) {
    for (const o of w.obs) { if (o.t === 'platform') drawPlatform(o); else if (o.t === 'spring') drawSpring(o); }
    for (const o of w.obs) {
      if (o.t === 'spike') drawSpike(o); else if (o.t === 'thorn') drawThorn(o); else if (o.t === 'hang') drawHang(o);
      else if (o.t === 'wall') drawWall(o); else if (o.t === 'ball') drawBall(o); else if (o.t === 'bat') drawBat(o, w);
    }
    for (const it of w.items) { if (it.t === 'jelly') drawJelly(it, uiT); else drawPickup(it, uiT); }
    // 부스터 속도선
    if (w.boostT > 0) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3; for (let i = 0; i < 9; i++) { const y = 30 + i * 34 + (uiT * 900 + i * 97) % 20, x = ((i * 233 - uiT * 1600) % VW + VW) % VW; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 50, y); ctx.stroke(); } }
    drawCookie(w, uiT);
  } else {
    // 타이틀 뒤: 달리는 쿠키
    drawCookie({ ck: { y: GROUND, onGround: true, sliding: false, inv: 0, anim: uiT, vy: 0 }, boostT: 0, hp: 100 }, uiT);
  }
  for (const p of particles) { ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.5)); ctx.fillStyle = p.color; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); }
  ctx.globalAlpha = 1;
  for (const tx of texts) {
    ctx.globalAlpha = Math.max(0, 1 - tx.t / 0.9); ctx.font = "22px 'Jua', sans-serif"; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.strokeText(tx.text, tx.x, tx.y); ctx.fillStyle = tx.color; ctx.fillText(tx.text, tx.x, tx.y);
  }
  ctx.globalAlpha = 1;
  if (w) {
    drawHud(w);
    // 구역 이름 안내
    const m = meters(w), zone = Math.floor(m / 400);
    const into = m - zone * 400;
    if (zone > 0 && into < 40) {
      ctx.globalAlpha = Math.min(1, (40 - into) / 15); ctx.font = "30px 'Jua', sans-serif"; ctx.textAlign = 'center';
      ctx.strokeStyle = INK; ctx.lineWidth = 7; ctx.strokeText(BIOMES[zone % 3].name, VW / 2, 120); ctx.fillStyle = '#fff'; ctx.fillText(BIOMES[zone % 3].name, VW / 2, 120);
      ctx.globalAlpha = 1;
    }
    if (w.hp < 25 && state === 'play') { ctx.fillStyle = `rgba(255,60,90,${0.12 + 0.1 * Math.sin(uiT * 9)})`; ctx.fillRect(0, 0, VW, H); }
  }
  ctx.restore();
}

// ---------- Main loop ----------
let last = 0, acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  uiT += dt;
  if (shake > 0) shake = Math.max(0, shake - dt);
  if (hpFlash > 0) hpFlash = Math.max(0, hpFlash - dt);

  if (world && (state === 'play' || state === 'dead')) {
    if (state === 'play') {
      acc += dt;
      let steps = 0;
      while (acc >= 1 / 120 && steps++ < 12) {
        acc -= 1 / 120;
        inp.jumpHeld = jumpKeys.size > 0 || [...pointers.values()].includes('jump');
        inp.slide = slideKeys.size > 0 || [...pointers.values()].includes('slide');
        stepWorld(world, 1 / 120, inp);
        if (world.events.length) { handleEvents(world.events); world.events = []; }
        if (state !== 'play') break;
      }
      updateHud();
      // 달리는 먼지
      if (world.ck.onGround && Math.random() < 0.35) particles.push({ x: CX - 12, y: GROUND - 2, vx: -world.speed * 0.25, vy: -25, life: 0.3, r: 2, color: 'rgba(255,255,255,.8)' });
    }
  }
  for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; }
  particles = particles.filter((p) => p.life > 0);
  for (const tx of texts) { tx.t += dt; tx.y -= 40 * dt; }
  texts = texts.filter((tx) => tx.t < 0.9);
  drawScene(world, dt);
  requestAnimationFrame(frame);
}

// ---------- Input ----------
const jumpKeys = new Set(), slideKeys = new Set();
const pointers = new Map();        // pointerId -> 'jump' | 'slide'
const JUMP_CODES = ['Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyK'], SLIDE_CODES = ['ArrowDown', 'KeyS', 'KeyX', 'KeyJ'];
function pressJump() { if (state === 'play') { inp.jump = true; inp.jumpHeld = true; } }

addEventListener('keydown', (e) => {
  if (JUMP_CODES.includes(e.code) || SLIDE_CODES.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (JUMP_CODES.includes(e.code)) {
    if (state === 'title' || (state === 'dead' && !$('overlay').classList.contains('hidden'))) { startGame(); return; }
    if (state === 'paused') { resume(); return; }
    jumpKeys.add(e.code); pressJump();
  } else if (SLIDE_CODES.includes(e.code)) slideKeys.add(e.code);
  else if (e.code === 'Enter' && (state === 'title' || state === 'dead')) startGame();
  else if (e.code === 'KeyP' || e.code === 'Escape') state === 'paused' ? resume() : pause();
  else if (e.code === 'KeyM') toggleMute();
});
addEventListener('keyup', (e) => { jumpKeys.delete(e.code); slideKeys.delete(e.code); });
addEventListener('blur', () => { jumpKeys.clear(); slideKeys.clear(); pointers.clear(); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { jumpKeys.clear(); slideKeys.clear(); pointers.clear(); pause(); } });

// 화면 버튼과 화면 탭 (왼쪽 절반 = 슬라이드, 오른쪽 절반 = 점프)
function bindPointer(el, kindOf) {
  el.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    const kind = kindOf(e);
    pointers.set(e.pointerId, kind);
    if (kind === 'jump') pressJump();
    if (e.currentTarget.classList) e.currentTarget.classList.add('on');
  });
  const up = (e) => { pointers.delete(e.pointerId); if (el.classList && ![...pointers.values()].length) el.classList.remove('on'); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
}
// 게임 화면을 탭하면 점프 (길게 누르면 높이). 슬라이드는 왼쪽 버튼이나 ↓ 키.
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  pointers.set(e.pointerId, 'jump');
  pressJump();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
});
const canvasUp = (e) => pointers.delete(e.pointerId);
canvas.addEventListener('pointerup', canvasUp);
canvas.addEventListener('pointercancel', canvasUp);
canvas.addEventListener('lostpointercapture', canvasUp);
bindPointer($('btnSlide'), () => 'slide');
bindPointer($('btnJump'), () => 'jump');

const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || /[?&]pad=1/.test(location.search);
if (isTouch) document.body.classList.add('touch');

function toggleMute() {
  muted = !muted;
  store.set('runcookieMuted', muted ? '1' : '0');
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
}
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

showTitle();
updateHud();
fit();
requestAnimationFrame(frame);
}
