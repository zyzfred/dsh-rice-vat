# Attribution & character provenance

## 1. Licence summary

This package is released under the **MIT licence** as a whole — code *and*
artwork. See `LICENSE` at the package root.

| Part | Licence |
|---|---|
| `index.js`, `client.js`, `icon.svg`, SVG fallbacks | MIT |
| `assets/*.webp` (vw, all eight states) | MIT, same as above |

## 2. Character provenance — 鲸鱼娘 / 大肥鱼

The whale-girl in this plugin follows the **community-created 鲸鱼娘 (whale girl)
/ 大肥鱼** fan character.

That character is **decentralised**: the community asset library explicitly states
there is no canonical setting, and that the library is maintained by the community
and does **not** represent DeepSeek or any official position.

- Community asset library: <https://github.com/TreapGoGo/deepseek-whale-girl> (MIT)
- Character reference sheet used for generation: provided by the package author
- Art generation: authored by the package author with AI image generation tooling

**This plugin is not an official DeepSeek project.** It is not affiliated with,
endorsed by, or connected to DeepSeek / 深度求索. No DeepSeek trademark or logo is
used as this project's own identity.

## 3. Current artwork (v2 package, 2026-11-11)

Eight state images, delivered at 1024×1024 RGBA with a shared canvas and a shared
vat body:

| File | Source name | Content |
|---|---|---|
| `vat-overflow.webp` | `vat-overflow.png` | 米堆成小山，溢出缸口 |
| `vat-full.webp` | `vat-full.png` | 米面平齐缸口 |
| `vat-low.webp` | `vat-low.png` | 缸底只剩几粒米 |
| `vat-empty.webp` | `vat-empty.png` | 空缸 |
| `girl-idle.webp` | `girl-idle.png` | 正面待机 |
| `girl-eat.webp` | `girl-eat.png` | 抱着大碗埋头吃 |
| `girl-low.webp` | `girl-low.png` | 低米量／饥饿 |
| `girl-sleep.webp` | `girl-sleep.png` | 趴着睡 |

Two helper layers, cropped with the same registration, drive the continuous rice
level between ¥6 and ¥100:

| File | Content |
|---|---|
| `vat-rice-mask.webp` | 缸口内部遮罩 |
| `vat-rice-overlay.webp` | 平口米面叠加层 |

All ten files are cropped with **one common box** `(74, 62, 952, 962)` and resized
to 512 px wide, so every frame keeps a single registration. That shared
registration is what lets `girl-sleep` be laid directly over `vat-empty` (the
sleeping lift is `-52%` of the box height).

### Eating animation

`girl-eat.webp` is a 16-frame animated WebP rebuilt from the author's sources:

- Frames: `Chibi whale maid rice-munching animation.png` (4×4 grid, 1254×1254,
  true alpha)
- Timing: `whale_girl_eating_transparent.gif` (16 frames, 4.6 s, frame durations
  `[420, 220×14, 1100]` ms, infinite loop)

The grid was preferred over the GIF because the GIF only carries 1-bit
transparency. Frame order was verified by comparing the white-rice pixel fraction
frame by frame.

## 4. Previously used artwork (removed)

An earlier development build used four MIT-licensed sprites from
**Sutera-Diffusus/dsh-whale-musume** (`idle / eat / low / sleep.webp`). They were
deleted when the author's own artwork replaced them and are **not** part of this
package.

## 5. Plugin code

`index.js`, `client.js`, `icon.svg`, and the SVG fallbacks are original to this
package. The rice-vat geometry, the four-tier balance mapping, the continuous
rice-surface compositing, and the page-token authentication are this package's own
work.
