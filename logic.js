'use strict';

// 달려라 쿠키: 규칙만 모아 둔 파일 (그리기·입력·소리 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 쿠키가 끝없이 달린다. 점프(누른 만큼 높이, 2단 점프)·슬라이드로 장애물을 피하고 젤리를 먹는다
// - 체력은 계속 닳고 물약으로 채운다. 부스터는 장애물을 부수며 날고, 자석은 젤리를 끌어당긴다
// - 400m마다 구역이 바뀌고 장애물 종류가 하나씩 늘어나며 빨라진다
// stepWorld(w, dt, inp) 가 한 번 진행하고 w.events 에 일어난 일을 남긴다. 소리·효과·화면은 game.js 가 맡는다.
const LOGIC_RUNCOOKIE = (() => {
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
const ROCK_DROP = 320;              // 바위가 떨어지기 시작하는 높이
const LASER_CYCLE = 2.0, LASER_ON = 1.15;           // 빔이 켜졌다 꺼지는 한 바퀴(초)와 켜져 있는 시간. 켜지기 직전 0.35초는 깜빡인다
const LASER_LO = 28, LASER_HI = 44;                 // 빔의 높이(바닥 기준): 서 있으면 맞고, 슬라이드(머리 20)나 점프(발 44 이상)는 지나간다
const HOP_VX = 60, HOP_H = 68, HOP_OM = 4.6;        // 슬라임은 세상보다 이만큼 더 빨리 다가오며, 최대 이만큼 튀어 오른다
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
const pop = (dx) => ({ t: 'pop', dx, w: 110, h: 42, pop: 0 });              // 땅이 갈라져 있다가 가까워지면 솟는 가시 (뛰어서 넘는다)
const rock = (dx) => ({ t: 'rock', dx, w: 44, h: 44, drop: ROCK_DROP, fv: 0, landed: false });   // 가까워지면 위에서 떨어지는 바위 (떨어진 뒤에는 뛰어서 넘는다)
const laser = (dx, ph) => ({ t: 'laser', dx, w: 150, h: 44, ph });         // 깜빡이는 가슴 높이 빔: 켜져 있을 땐 슬라이드나 점프
const hopper = (dx, ph) => ({ t: 'hopper', dx, w: 34, h: 32, vx: HOP_VX, ph });   // 통통 튀며 다가오는 슬라임: 뛰어 넘거나 높이 떴을 때 슬라이드

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
  pop: { half: (s) => halfSpan(s), build: (c, s) => ({ obs: [pop(c - 55)], items: arcAt(c, s) }) },
  rock: { half: (s) => halfSpan(s), build: (c, s) => ({ obs: [rock(c - 22)], items: arcAt(c, s) }) },
  laser: { half: () => 110, build: (c, s, w) => ({ obs: [laser(c - 75, rand(w) * LASER_CYCLE)], items: line(c - 95, 6, 20, 38) }) },
  hopper: { half: (s) => halfSpan(s), build: (c, s, w) => ({ obs: [hopper(c - 17, rand(w) * 6.28)], items: arcAt(c, s) }) },
  bats: { half: () => 160, build: (c, s, w) => { const p = rand(w) * 6.28; return { obs: [bat(c - 120, p), bat(c - 20, p + 2.1), bat(c + 80, p + 4.2)], items: line(c - 150, 8, 22, 38) }; } },
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
  wall: { min: 450, w: [1.2, 2.4] },
  pop: { min: 200, w: [1.2, 2.2] }, rock: { min: 380, w: [1.2, 2.4] }, laser: { min: 430, w: [1.2, 2.4] }, hopper: { min: 520, w: [1.2, 2.4] }, bats: { min: 700, w: [0.8, 2.4] },
  platform: { min: 500, w: [1.2, 2] }, platPit: { min: 620, w: [1, 2] }, spring: { min: 560, w: [1, 1.8] },
};
// 구역(400m마다)마다 자주 나오는 장애물이 달라진다
const FAVOR = [
  ['spike1', 'spike2', 'spike3', 'pit', 'hang', 'arc', 'pop'],          // 사탕 나라
  ['thorn', 'ball', 'bat', 'wall', 'line', 'rock', 'hopper'],                      // 초코 숲
  ['platform', 'platPit', 'spring', 'sky', 'bat', 'pit', 'laser', 'bats'],        // 별밤 정원
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
    const p2 = Math.max(0, Math.min(0.65, (m - 120) / 400)), p3 = Math.max(0, Math.min(0.4, (m - 400) / 600)), p4 = Math.max(0, Math.min(0.5, (m - 900) / 800));
    let n = 1;
    if (rand(w) < p2) { n = 2; if (rand(w) < p3 / 0.65) { n = 3; if (rand(w) < p4) n = 4; } }
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

// 빔이 켜져 있는가 / 켜지기 직전인가(깜빡임) / 슬라임이 땅에서 떠 있는 높이
const laserPhase = (w, o) => (w.t + o.ph) % LASER_CYCLE;
const laserOn = (w, o) => laserPhase(w, o) < LASER_ON;
const laserWarn = (w, o) => { const p = laserPhase(w, o); return p >= LASER_CYCLE - 0.35; };
const hopLift = (w, o) => HOP_H * Math.abs(Math.sin(o.ph + w.t * HOP_OM));

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
    case 'pop': return o.pop > 0.6 ? [{ l: o.x + 8, r: o.x + o.w - 8, t: GROUND - o.h * o.pop, b: GROUND }] : [];
    case 'rock': return [{ l: o.x + 4, r: o.x + o.w - 4, t: GROUND - o.drop - o.h, b: GROUND - o.drop }];
    case 'laser': return laserOn(w, o) ? [{ l: o.x, r: o.x + o.w, t: GROUND - LASER_HI, b: GROUND - LASER_LO }] : [];
    case 'hopper': { const lift = hopLift(w, o); return [{ l: o.x + 5, r: o.x + o.w - 5, t: GROUND - lift - o.h, b: GROUND - lift }]; }
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
  for (const o of w.obs) {
    if (o.t === 'pop') {                                   // 가까워질수록 솟는다 (0.5초 전부터 올라와 0.3초 전에 다 솟는다)
      const gap = o.x + o.w / 2 - CX;
      o.pop = Math.max(0, Math.min(1, (w.speed * 0.5 - gap) / (w.speed * 0.2)));
    } else if (o.t === 'rock' && !o.landed) {              // 0.8초쯤 앞에서 떨어지기 시작
      if (o.x - CX < w.speed * 0.8 + 40) {
        o.fv += GRAV * 1.2 * dt; o.drop -= o.fv * dt;
        if (o.drop <= 0) { o.drop = 0; o.landed = true; ev(w, 'thud', { x: o.x, w: o.w }); }
      }
    }
  }
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

return {
  W, H, GROUND, CX, PX_PER_M, JUMP_V, JUMP2_V, GRAV, SPEED0, SPEED_MAX, HP_MAX, HIT_DMG, FALL_DMG, POTION_HP, BOOST_T, MAGNET_T, INV_T,
  STAND_H, SLIDE_H, HANG_CLEAR, PRIM, KIND_INFO, FAVOR, PATH1, PATH2, PATH_SPRING, halfSpan, SPRING_V, BALL_VX, BAT_VX,
  LASER_CYCLE, LASER_ON, LASER_LO, LASER_HI, ROCK_DROP,
  composeKinds, buildChain, pickKind, supportY, batHeight, laserOn, laserWarn, laserPhase, hopLift,
  newWorld, stepWorld, meters, scoreOf, spawnPattern, overPit, cookieBox, obsBoxes, gapFor, chainGap, spawnGap, hit,
};
})();
if (typeof module !== 'undefined') module.exports = LOGIC_RUNCOOKIE;
