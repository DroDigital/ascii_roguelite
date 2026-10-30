# VELLUM — Design Spec (vertical slice)

Date: 2026-10-29
Status: Build brief approved by the requester, who asked for autonomous completion. This file records the decisions made to meet it. Changes to decisions go here first.

## 1. Goal and success criteria

- A playable browser roguelite: title → loadout → explore a branching run of rooms → fight → choose upgrades → face a two-phase boss → win or die → unlock → restart. Target run length 10–15 minutes.
- One biome, **The Sunken Scriptorium**: a flooded archive where written characters have taken flesh. Architecture, creatures, weapons, smoke and magic share one glyph language.
- Verified by Vitest unit tests, a Playwright end-to-end run covering the full loop, screenshots reviewed for legibility, and measured frame times. Frame-time claims are limited to what software GL can show here (see §13).

## 2. Stack

- TypeScript, Vite, Three.js (WebGL2). Three.js supplies the scene graph, lights, shadow maps and geometry. All ASCII rendering is custom GLSL.
- All text UI (HUD, menus, labels) is DOM, so it stays crisp at any render resolution.
- Audio is synthesized with WebAudio. No audio asset files.
- Font: IBM Plex Mono via `@fontsource` (OFL). The same font builds the glyph atlas and styles the UI, so glyphs look identical everywhere.
- Why this stack: the repo had no existing stack. A browser build needs no install, uses the GPU through WebGL2, and can be verified here with headless Chromium. Unity and Godot are not installed here and cannot be verified in this environment.

## 3. Module layout

- `core/`: `rng` (mulberry32 plus hash and value noise), `settings`, `progress` (meta save), `input`, `app` (state machine and fixed-step loop).
- `render/`: `glyphs` (glyph set, ramps, atlas), `asciiRenderer` (GPU passes and temporal state), `shaders`, `overlay` (CPU glyph layer).
- `world/`: `templates` (authored room maps), `layout` (transforms, doors, validation), `generator` (run route and room seeds), `grid` (tiles, collision, DDA raycast, flood fill), `roomBuilder` (meshes).
- `model/`: `rig` (bone hierarchy, pose blending, foot planting for enemies), `characters` (husk, acolyte, bulwark, elite, scribe), `viewmodel` (first-person hands and weapons), `materials` (shared materials and geometry cache).
- `sim/`: `camera` (first-person look, head bob, roll, FOV kick, shake), `player` (first-person controller), `weapons` (data), `tear` (signature mechanic), `combat` (damage, armor, cores, status), `enemies/` (archetype data plus a shared state machine), `boss`, `projectiles`, `upgrades`, `run` (director).
- `fx/`: `effects` (slash arcs, impact debris, collapse streams, telegraph patterns, distortion triggers).
- `audio/`: `audio` (cue synthesis) and `ambience`.
- `ui/`: `hud`, `screens` (title, loadout, settings, pause, upgrade, victory, defeat, codex), `styles.css`.

Per frame: input → `app.update(dt)` runs fixed 1/60 s simulation steps (hit-stop skips them) → sim state → `fx` and overlay built → renderer draws → DOM HUD updates.

## 4. ASCII rendering pipeline

Grid. Cell size in CSS pixels comes from the glyph-density setting: Fine 6×12, Standard 8×16 (default), Bold 10×20. Device cell = round(CSS cell × DPR). `cols = floor(W / cellCSS.w)`, `rows = floor(H / cellCSS.h)`. The grid is centred and letterboxed.

Sample grid. `sx` comes from quality (Low 1, Medium 2, High 3) and `sy = 2·sx`. Sample texels are square on screen because cells are 1:2. The scene render target is `cols·sx × rows·sy`, with HalfFloat colour and a `DepthTexture`.

Pass 1, scene. Lit geometry rendered into the sample target. Key directional light with a 2048 shadow map, a back rim light for silhouettes, hemisphere ambient, and four candle point lights at constant count. Fog fades to black with distance.

Pass 2, reduction (one fragment per cell, ping-pong state):
- Average luminance `L`, average colour `C`, and depth-discontinuity edge measure from a Sobel pass over sample depths.
- Normal from depth reconstruction, rotated to world space. Its world-up component picks a surface family: floor, wall or default.
- Edge glyph when the relative depth jump is above 0.12. Orientation chooses `| / - \`. A jump above 0.4 gives the silhouette glyph `#`.
- Otherwise a ramp glyph by family. Floors use a dust ramp, walls a hatch ramp, other surfaces the default ramp.
- Temporal stability: smoothed brightness `S += (L - S)·(1 − e^(−14·dt))`. The glyph index keeps its previous value unless the new level moves more than 0.6 levels (deadband). A family change resets the state.
- Fog fields: two octaves of world-space value noise drift add sparse `. : ~` glyphs to dim cells. Strength follows the effects-intensity setting.
- Outputs: MRT0 = state (glyph, S, edge, family), MRT1 = colour (rgb, glow). If MRT is unavailable at runtime, split into two passes.

Pass 3, composite (per device pixel): cell lookup with up to three radial distortion offsets from powerful attacks. Those distortions are scaled by effects intensity and off under reduced motion. The glyph comes from the atlas, tiles sized to the device cell, multiplied by colour. A small glow comes from the four neighbour cells. The CPU overlay glyph is then alpha-blended on top. A vignette finishes the frame.

Overlay (CPU). A `cols × rows` RGBA8 texture: R = glyph index, G = palette index, B = alpha. The palette is ivory, ember, amber, cyan, ash and white. Effects write here: slash arcs, debris, telegraph patterns, fragment streams and pickup markers.

Settings: glyph density, contrast (brightness exponent, 0.6–1.6), quality (`sx`), effects intensity (0–100%), screen shake (0–100%), hit-stop (on/off), reduced motion (on/off), show frame stats (on/off).

## 5. Visual language

Palette. Only these hues carry meaning:
- Ivory `#efe6cf`: world, player, neutral text.
- Ember `#ff5a3c`: danger. Telegraphs, hurt flashes, burning, boss rage.
- Amber `#ffb84a`: resources. Shards, gilded elite plating, rare reward cards.
- Cyan `#5fe6e0`: abilities. Tear charge, fragments, quill bolts, aim line, dodge ghosting.
- Ash `#6b6860`: fog, dust, locked or inactive things.

Silhouettes. Husk: hunched, long arms. Acolyte: tall robed figure with a floating seal. Bulwark: squat, carries a glyph shield. Elite Bulwark: crown spikes and gilded plates. Scribe: tall hooded figure with an open book.

Armour and cores. Armour is drawn as glyph plating. Tearing it off exposes a bright core point.

## 6. Gameplay rules

Camera (first person). The camera sits at eye height, 1.55 units, at the player's position. Vertical FOV is 60°. Mouse look turns yaw freely and pitch within ±70°. Pointer lock is captured on click, and arrow keys turn as an alternative. Head bob follows movement, with a small roll while strafing. Dodge widens the FOV briefly. Shake and hit kicks act on the same camera. The 0.35 collision radius keeps the eye out of walls. Attackers outside the view get an ember screen-edge marker that points toward them.

Player. 100 HP. Movement 6.2 units/s with acceleration 40. Collision radius 0.35 units. Movement is relative to view yaw: W forward, S back, A and D strafe. The body is not drawn. A viewmodel shows the hands and the active weapon, and its swings carry the anticipation and follow-through.

Glaive (melee, default). Three-hit combo. Each swing has windup, active and recovery times of 0.14, 0.10 and 0.22 s. Arc 120° by 2.1 units. Damage 14, 16, 26. The third hit knocks back and pulses distortion. The combo window is 0.45 s.

Quill (ranged). Auto-fires while the button is held, cadence 0.26 s. Bolts travel along the view direction at 17 units/s, with damage 9 and life 1.2 s. Aim assist bends a bolt up to 6° toward an enemy near the crosshair. A cyan reticle marks the aim point.

Dodge (Space). 0.42 s roll at 13 units/s in the move direction, or along the view if standing still. Invulnerable from 0.05 to 0.30 s. Cooldown 0.85 s. The camera rolls and the FOV widens during the roll. The viewer sees ghosted cyan while invulnerable, and the HUD shows an i-frame pip.

Tear (signature, right-button hold). Charge 0.9 s, with a ring of cyan glyphs gathering and turning ivory at full charge. Release fires a line 6.5 units long and 1.4 wide. Each enemy hit removes one armour layer. Four fragments spawn, orbit for 2.8 s and fire at the nearest enemy every 0.5 s for 7 damage each. Cooldown 2.2 s.

Armour and cores. While an enemy has armour layers, normal damage is 35%. Tear or Breaker's Edge removes one layer. At zero layers the core is exposed for the rest of that enemy's life and takes extra damage.

Status. Burn: ember tint, 4 damage/s for 3 s. Stagger: a heavy hit interrupts windups.

Enemies:
- Husk (melee pursuer): HP 34, speed 3.3. Lunge when within 2.4 units: windup 0.55 s with arms raised and an ember line telegraph, dash 0.16 s at 9 units/s, recovery 0.7 s, damage 12. Drops health motes 20% of the time.
- Acolyte (ranged): HP 26. Holds 5–7 units away. Windup 0.7 s with a growing ring around the staff, then fires a seal bolt at speed 8 for 9 damage. Recovery 0.9 s. One armour layer (glyph robe).
- Bulwark (heavy, controls space): HP 110, speed 2.0, two armour layers. Slam: windup 1.0 s, then a shockwave ring of radius 3.2 for 22 damage and knockback. Charge: windup 0.8 s, then 7 units at 9 units/s. Hitting a wall stuns it for 1.5 s.
- Gilded Bulwark (elite): HP 190, three armour layers, speed 2.2. Uses double slam, a five-bolt seal fan and charge.
- The Scribe (boss): HP 520.
  - Phase 1, Seal Keeper (≥ 50% HP): three seal plates as armour layers. Book slam (three staggered expanding rings), seal volley (three-bolt fan), page sweep (150° arc).
  - Phase 2, Unbound (< 50% HP): page storm (eight radial page blades that return), ink rain (five telegraphed hazard circles), triple dash with an ember trail.
  - Transition: 1.4 s invulnerable, hit-stop, distortion pulse, stinger.

Pickups. Shards (amber `*`, resource currency, one to three per kill). Health motes (ivory `+`, 8 HP).

Fair spawns. Enemies spawn at least 7 units from the player, at least 3 units from each other, and only on tiles flood-reachable from the entry door. At most four enemies are active at once.

Telegraphs. Every enemy attack has a windup of at least 0.5 s with a visible shape and a sound cue. Dodge windows are at least 0.3 s.

## 7. Rooms and route

Templates. Authored ASCII maps: nave, Hall of Hooks, Stacks, Choir, Cistern, Ossuary, Lectern Gallery, Reliquary, Boss arena. Typical size 24×16 tiles, boss 30×22. Legend:
- `#` wall
- `.` floor
- `o` pillar
- `,` ink pool (slows 35%)
- `d` door opening
- `s` enemy spawn
- `c` candle light
- `a` altar

Transforms. Four rotations, each optionally mirrored, giving up to eight variants per template.

Validation (run for every generated room):
1. Each door is on the room boundary with floor directly inside it.
2. Every door is reachable from the entry and from every spawn by flood fill.
3. Spawns are on floor, at least 6 tiles from any door, and there are at least three of them.
4. No two doors share a tile.

Route. Tiers: T0 nave → T1 {Hall of Hooks, Stacks} → T2 {Choir, Cistern} → T3 {Ossuary, Lectern Gallery} → T4 Reliquary (elite) → T5 Boss. Each room exposes two doors that lead to the next tier's options, and each door label shows the target. The entry side of the next room is the opposite of the exit side used.

## 8. Run flow

Title → Loadout (weapon: Glaive, or Quill once unlocked; one boon from those unlocked; zero to two modifiers from those unlocked) → Run.

Transitions take a 0.6 s fade. A cleared combat room opens an upgrade pick of three offers. Rare offers appear 15% of the time. The Cistern offers Mend (+45% HP) or Attune (one rare pick for −20 max HP). The Reliquary holds an elite with two husks and gives a rare pick. Killing the Scribe is a win. Player death is a loss. Both screens show a summary with Restart (Enter or R) and Title.

## 9. Upgrades and combos

Twelve upgrades, each with a tradeoff:
1. Ember Edge (Glaive): hits burn for 4/s over 3 s.
2. Wide Crescent (Glaive): arc +35%, recovery +15%.
3. Riposte (Glaive): after a dodge, the next swing deals +75% and staggers.
4. Breaker's Edge (Glaive): hits remove one armour layer. Damage −15%.
5. Piercing Sigil (Quill): bolts pierce one enemy. Damage −20%.
6. Scatter Sigils (Quill): three-bolt fan at 55% damage each.
7. Kindling (any ignition): burning enemies burst for 14 on death and ignite nearby enemies.
8. Glyph Lattice (Tear): two extra fragments, fragments last +2 s. Tear cooldown +0.6 s.
9. Fragment Barrage (Tear): fragments fire every 0.25 s instead of 0.5 s.
10. Core Piercer (Tear): exposed cores take +60% instead of +40%. Tear charge takes 25% longer.
11. Blank Step (Dodge): dodge cooldown −35%, distance −15%. The dodge trail deals 6 to enemies it crosses.
12. Brittle Vow (general): damage +35%, max HP −25.

Combos, each discovered when both members are owned. The first discovery shows a banner and fills a codex entry:
- Pyre: Ember Edge + Kindling. Ignited enemies detonate on death and spread ignition.
- Mirror Step: Blank Step + Riposte. Trail hits count as a dodge for Riposte.
- Starfall: Piercing Sigil + Scatter Sigils. Bolts pierce and the fan widens.
- Orbit Storm: Glyph Lattice + Fragment Barrage. Fragments fire immediately on release.
- Unshelled: Breaker's Edge + Core Piercer. Armour broken by a Glaive hit also exposes the core for 2 s.

## 10. Meta progression (saved locally)

- Quill is unlocked after the first completed run, win or loss.
- Boons (start choices): Ash Ward (+25 max HP, unlocked by defeating the Reliquary elite), Scribe's Pouch (+12 shards, unlocked by visiting a Cistern), Dust Step (+1 dodge charge, unlocked by the first victory).
- Modifiers: Ink Famine (healing only from Mend, shard drops +40%, unlocked by the first victory), Gilded Path (elites appear in T2 and T3 rooms, one extra rare offer, unlocked by reaching the boss).
- Stats: runs, wins, best win time, kills, and codex entries for combos and upgrades seen.
- Storage: localStorage key `vellum.save.v1`, versioned JSON. All reads and writes are wrapped in try/catch, and unknown or corrupt data is ignored.

## 11. Settings

Audio: master, SFX, ambience. Visuals: glyph density, contrast, quality, effects intensity, screen shake, hit-stop, reduced motion, frame stats. Controls are fixed and listed on the title and pause screens. Settings persist in the same save, under a separate key.

Controls: WASD move; mouse look (click to capture, Esc releases); arrow keys turn; LMB attack (Glaive combo, Quill auto-fire); RMB hold Tear; Space dodge; E interact (altars); P pauses, and losing pointer lock also pauses; 1–3 pick upgrades; Enter or R restart from end screens.

## 12. Audio cues

WebAudio synthesis, all cues distinct in timbre:
- Glaive swing: filtered noise sweep, pitch rising per combo step.
- Quill shot: short chirp.
- Enemy hit: thump plus click. Heavy hit: deep thud.
- Player hurt: dissonant low burst.
- Dodge: rising air sweep plus a ping.
- Shard pickup: two-tone amber chime. Health: soft bell.
- Telegraphs, one per archetype: Husk rattle ticks, Acolyte rising chirp, Bulwark low hum swell, Elite bell, Scribe toll.
- Tear charge: rising buzz. Release: crackle and whoosh. Armour break: glass tick.
- Enemy death: descending sweep with dust. Phase change: stinger chord. UI: soft tick.
- Ambience: detuned saw drone through a low-pass with slow LFO, an airy noise bed, occasional page rustles and a distant bell.

## 13. Verification and performance

- Vitest unit tests: RNG determinism; template validation over all templates, transforms and 50 seeds; route validity; upgrade stacking and combo detection; combat maths (armour, cores, burn); save parsing with corrupt and unknown data; settings clamping.
- Playwright end-to-end (Chromium, software WebGL): boot with no console errors; title → loadout → run; movement changes position; attacks spawn arcs; dodge sets the invulnerability flag; pause and resume; settings persist; forced win and forced loss through the test API; restart works. Screenshots are saved for review.
- Performance: frame time at 1920×1080 under headless software GL is recorded in `docs/PERFORMANCE.md`. Software GL is not a stand-in for a real GPU, so the 60 FPS target on the stated baseline (GTX 1060-class, Standard quality) stays unverified here, and the document says so.
- Test API: `window.vellum` is exposed only when the URL contains `?test=1`. It provides seeded starts, forced upgrades, skip-to-boss, a look setter (yaw and pitch) and state reads.

## 14. Known limits

Recorded in README.md. The main ones: frame rate on real hardware is unverified (software GL only); pointer lock and audio were not checked by hand; balance has not been playtested by people; fog and effects are overlay approximations; enemy movement is grid-based with no navmesh.
