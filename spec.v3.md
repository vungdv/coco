# Voice commands — spec v3
[spec v1](spec.md) and [spec v2](spec.v2.md) still hold unless this document replaces them.

## 1. Problems
- **New order.** A customer comes to the restaurant in person, and the chef wants to record that order in the system.
- **Fix an order.** The Assistant read the wrong number from a Zalo message, so the chef wants to correct the order.
- **Change an order.** A customer pre-ordered on Zalo, then comes in and changes it by talking to the chef.

The chef's hands are busy or dirty, so typing is slow. The Assistant is a separate system: `/Users/vung.do/projects/zalo/zalo-order-assistant` (remote: https://github.com/vungdv/coco-zalo-qwen).

## 2. Goal
The chef can give a **voice command** to:
- **add** an order: "Lê Hương, 4 suất" (no open order for her yet)
- **update** an order: "Lê Hương, 4 suất" (she already has one: set it to 4), "Lê Hương thêm 2", "Lê Hương bớt 1"
- **cancel** an order: "Lê Hương, huỷ đơn"
- **delete** an order: "Lê Hương, xoá đơn"

Each command applies to the **date shown on screen**. The chef sees the command move from *sent* to *done* (or *failed*, with a reason) within a few seconds.

**Non-goals (v3):** saying a date out loud ("mai", "thứ sáu"), several customers in one command, undo, picking between ambiguous customers in the UI, prices.

## 3. Decisions
| # | Decision | Why |
|---|---|---|
| E1 | Speech to text runs **in the browser** (Web Speech API, `lang = 'vi-VN'`, `interimResults`), as in the [spike](https://github.com/vungdv/voice-to-text-on-browser-spike). The server only ever receives **text**. | No audio upload or storage. It works on Chrome (Android, desktop) and Safari (iOS ≥ 14.5). Note: the browser sends audio to Google or Apple for recognition. |
| E2 | A command is stored first as a `voice_commands` row (`queued`), and **only the Assistant** turns it into order lines. The web never writes orders. | Same path as Zalo messages: one parser, one Order API, one audit trail. The browser stays dumb and safe. |
| E3 | The Assistant claims queued commands through the **Voice Command API** (REST, `x-api-key`), not by reading the database. | Cross-system integration goes through published contracts only (AGENTS.md P2). |
| E4 | The command's `delivery_date` is the date on screen when it was recorded. The LLM never parses dates. | It is deterministic and matches what the chef is looking at. |
| E5 | Each resulting order line uses `source = 'voice'`, `external_id = <command id>`, `message = <transcript>`. | Re-processing a command is a no-op (v2 D4), and the row shows what the chef said. |
| E6 | "*Name*, N suất" means **set N** if the customer has an open order that day, otherwise **add N**. The Assistant calls `op: set`; on `409 no_open_order` it calls `op: add` with the same key. "thêm N" = `add`, "bớt N" = `reduce`, "huỷ" = `cancel`, "xoá" = `delete`. | The chef says the number they want to see on screen. No new upsert op is needed. |
| E7 | The spoken name is matched against that day's orders by the Assistant (case and word order ignored, e.g. "Hương Lê" = "Lê Hương"; rules in the [Assistant spec v3](/Users/vung.do/projects/zalo/zalo-order-assistant/spec.v3.md) V5). Exactly one match → use its `customer_id`. No match → `add` sends only `customer_name` (the backend keys it as `lower(trim(name))`, v2 D1), other ops **fail** (`not_found`). Two or more matches → **fail** (`ambiguous`), listing the candidates. | A wrong guess changes someone else's food. A failure is cheap: the chef says it again with the full name. The chef is expected to say the customer's Zalo name; when the names differ, the chef handles it (no automatic merge of customers). |
| E8 | **Delete** is a new op: the order is hidden from the list and the counts, but its lines are kept (`orders.deleted_at`, `deleted_by`). **Cancel** stays as in v2 (total 0, shown muted). | Cancel = "the customer said no" (staff must see it). Delete = "this order should never have existed" (a mistake). Lines stay immutable (v2 D3). |
| E9 | **Hold to talk** (variant B): the chef holds the bar while speaking and **releasing sends** the command. Sliding left before releasing cancels it. There is no review step. | One gesture, no second tap with busy hands. Misheard names are caught by the strict matching of E7 (a failure, not a wrong order), and the result bar says exactly what changed. |
| E10 | A command left `queued` for more than 30 s is shown as "Trợ lý chưa nhận" (the Assistant hasn't picked it up). It stays queued and is processed when the Assistant comes back, unless the chef dismisses it (`dismissed`). | The Assistant runs on a separate machine that may be off. The chef must not think a command worked when it hasn't. |

## 4. Flow
```
Chef ──tap 🎤──▶ Browser (Web Speech API) ──transcript──▶ chef reviews ──Send──▶
  web: insert voice_commands {transcript, delivery_date, status: queued}      (RLS: staff insert)
  web: Realtime on voice_commands (created_by = me) shows the result bar

Assistant ──POST /voice-commands/claim──▶ {command, open orders for that date}
  LLM extracts {customer, op, quantity}; code resolves the customer (E7)
  POST /orders {op, customer_id|customer_name, quantity, source: voice, external_id: command.id}
  PATCH /voice-commands/{id} {status: done, order_id, summary} | {status: failed, error, detail}

Web: Realtime on orders updates the row; the result bar shows ✓ "Lê Hương = 4" and scrolls to and highlights that row.
```

## 5. Data model
### `voice_commands` (new)
| Column | Notes |
|---|---|
| `id` uuid PK | also the order line's `external_id` (E5) |
| `transcript` text not null, 1–500 chars | what the chef sent (after any edit) |
| `delivery_date` date not null | E4 |
| `status` text | `queued` → `processing` → `done` \| `failed`; `queued` → `dismissed` |
| `claimed_at` timestamptz null | set by claim; a `processing` command older than 2 min can be claimed again |
| `result` jsonb null | `done`: `{op, order_id, customer_name, quantity, delta}` (`quantity` = the order total after, `delta` = the stored line's quantity, so the web can show "từ 7"); `failed`: `{error, detail, candidates?}` |
| `created_by` uuid → `auth.users` not null default `auth.uid()` | |
| `created_at`, `updated_at` | |

- RLS: staff `insert` (only `transcript`, `delivery_date`), `select` own rows, `update` only `status = 'dismissed'` while `queued`. Everything else goes through the Voice Command API (service role).
- Realtime publication includes `voice_commands`.

### `orders` (additive)
- `deleted_at` timestamptz null, `deleted_by` text null. The UI query adds `deleted_at is null`. The unique open-order index (v2 D2) becomes `where not delivered and deleted_at is null`, so a customer can get a new order after a delete.
- `place_order_line` accepts `op = 'delete'`: it stores a line with `quantity = -sum` (like cancel) and sets `deleted_at`. `delete` with no open order → `409 no_open_order`.

### Migration (forward-only)
`20261128000000_voice_commands.sql`: create `voice_commands` + RLS + Realtime; add `orders.deleted_at/deleted_by`; replace the open-order index; replace `place_order_line` with the `delete` version.

## 6. APIs
### Order API (`POST /functions/v1/orders`), additive
- `op` gains `delete` (no `quantity`, like `cancel`). Response `200` with the order (now `deleted_at` set).

### Voice Command API (`/functions/v1/voice-commands`), new, `x-api-key`
| Request | Response |
|---|---|
| `POST /voice-commands/claim` | `200` `{command: {id, transcript, delivery_date, created_at}, orders: [{customer_id, customer_name, quantity, delivered}]}` for the oldest claimable command (atomic `for update skip locked`), or `204` if none. `orders` = that date's non-deleted orders: the context for E7. |
| `PATCH /voice-commands/{id}` `{status: "done", result}` or `{status: "failed", result}` | `200` with the command. `409` if it is not `processing` (e.g. dismissed meanwhile). `422` on a bad body. |

Errors are Problem Details (RFC 7807). `failed.result.error` is one of `not_understood`, `not_found`, `ambiguous`, `no_open_order`, `order_api_error`, `assistant_error` (the Assistant spec v3 §4.4 says when each is used).

The Assistant polls `claim` every 2 s while it runs (a change in the other repo, done as its own step: §9 step 3).

## 7. UI (variant B: hold to talk)
Mockups: [Voice command — mockups](https://claude.ai/artifact/NUuQLm4XEtNwwBpfkNjzhr), row B (B1, B2). A4's fallbacks still apply.

- **Talk bar**: a full-width pill (72 px high) at the bottom, above the safe area, in `--accent`, labelled *Giữ để nói*. It is hidden when the browser has no Speech Recognition. When offline it is disabled. In demo mode a fake Assistant answers locally.
- **Holding** (B1): the bar grows to 96 px with a level waveform and a timer. A bubble above it shows the date the command applies to ("ĐANG NGHE · THỨ SÁU 28/11") and the live transcript (interim words greyed), with the hint *Thả tay để gửi · Vuốt sang trái để huỷ*. The list behind is dimmed.
- **Release**: recognition stops, the final transcript is sent at once (E9). Releasing with an empty transcript, or a hold shorter than 400 ms, sends nothing and shows *Giữ để nói* as a hint. Sliding left more than 80 px cancels. A hold is capped at 15 s (then it sends).
- **Result bar** (B2): under the date bar, newest on top, at most 2. States: *Đang gửi…* → *Trợ lý đang xử lý…* → ✓ *Đã huỷ đơn Chị Mai* / ✓ *Lê Hương = 4 suất (từ 7)* with the transcript and time below (fades after 5 s; tapping it scrolls to and highlights the row) or ⚠ *"Hương" có 2 người — Lê Hương · Hương Giang, nói đủ tên* (stays until dismissed). After 30 s queued: *Trợ lý chưa nhận* with *Bỏ* (E10).
- **Rows**: a voice line shows a mic icon before its delta, e.g. `🎤 =4  Lê Hương, 4 suất  09:12`. A deleted order disappears from the list (Realtime).
- First use asks for microphone permission. If it is denied, the bar becomes *Gõ lệnh* and opens a text field (A4); a typed command uses the same path.

**Open questions**
- **Q1.** ~~Auto-send or tap Gửi?~~ Decided 2026-11-28: auto-send on release (variant B).
- **Q2.** Should *delete* need a spoken or tapped confirmation? Proposal: no. It is reversible by a DB admin because lines are kept, and the result bar shows what was deleted.
- **Q3.** Undo from the result bar (a compensating command) is the natural next step now that there is no review. Out of scope for v3.

## 8. Scenarios (Given/When/Then)
v1 and v2 scenarios still apply.

**Commands**
- **W1 – Add by voice.** Given no order for Lê Hương on 28/11, When the chef sends "Lê Hương, 4 suất" while viewing 28/11, Then a new order Lê Hương = 4 appears with one `🎤 +4` line, and the result bar shows ✓.
- **W2 – Set by voice.** Given Lê Hương's open order is 7 (from Zalo), When "Lê Hương, 4 suất", Then a `=4` line (delta −3) and total 4 on the **same** order and `customer_id`.
- **W3 – Add / reduce.** Given total 4, When "Lê Hương thêm 2", Then total 6. When "Lê Hương bớt 1", Then total 5.
- **W4 – Cancel.** Given total 5, When "Lê Hương, huỷ đơn", Then total 0 and the row shows as cancelled (v2 D7).
- **W5 – Delete.** Given an open order, When "Lê Hương, xoá đơn", Then the row disappears, counts drop, and its lines are still in `order_lines`. Then When "Lê Hương, 2 suất", Then a new order of 2 appears.
- **W6 – Name variants.** Given the Zalo order is named "Hương Lê", When "lê hương 3 suất", Then it updates that order (E7).
- **W7 – Ambiguous.** Given two open orders "Lê Hương" and "Hương Giang", When "Hương huỷ đơn", Then nothing changes and the result bar shows ⚠ with both names.
- **W8 – Not found.** Given no "Minh" today, When "Minh bớt 1" (or huỷ / xoá), Then nothing changes and the result bar shows ⚠ *Không tìm thấy "Minh"*.
- **W9 – Not understood.** When "ừ để anh xem", Then the result bar shows ⚠ *Chưa hiểu lệnh* and nothing changes.
- **W10 – Date on screen.** Given the chef is viewing 29/11, When "Lê Hương, 2 suất", Then the order is on 29/11, not today.

**Pipeline**
- **W11 – Idempotent processing.** Given a command was applied but the Assistant crashed before `PATCH`, When it is claimed again, Then the Order API replays (`200`) and no second line is added.
- **W12 – Assistant offline.** Given the Assistant is stopped, When the chef sends a command, Then after 30 s the result bar shows *Trợ lý chưa nhận*. When the Assistant starts, Then the command is processed. When the chef taps *Bỏ* first, Then it is `dismissed` and never processed.
- **W13 – Single claim.** Given two Assistant instances, When both call `claim` at once, Then each command is returned to only one of them.
- **W14 – Stale claim.** Given a command `processing` for more than 2 min, When `claim` is called, Then it is returned again.
- **W15 – RLS.** Given a staff user, Then they can insert a command and see only their own; they cannot set `status = done` or `result`. Anon can do nothing.

**UI**
- **W16 – Release sends, slide cancels.** When the chef holds, says "Lê Hương 4 suất" and releases, Then one command with that transcript is stored. When they slide left before releasing, or release after < 400 ms or with no words, Then nothing is stored.
- **W17 – Unsupported / denied.** Given no Speech Recognition, Then no talk bar. Given mic permission is denied, Then the bar becomes *Gõ lệnh* and opens the text field.
- **W18 – Realtime result.** Given the result bar shows *đang xử lý*, When the Assistant marks it done, Then within ~2 s the result bar shows ✓ and the row is updated.

## 9. Plan
| Step | Scope (one bounded context each) | Done when |
|---|---|---|
| 1. Backend: commands + delete | Migration (§5), `delete` op in `place_order_line` and the Order API, Voice Command API (`claim`, `PATCH`). pgTAP + Deno tests. | W5 (API level), W11, W13–W15 pass. v2 tests green. |
| 2. Web: talk bar, result bar | `useSpeech` (Web Speech API wrapper), `useVoiceCommands` (insert + Realtime), `TalkBar.vue` (hold, slide-to-cancel), `ListeningBubble.vue`, `CommandResults.vue`, `TypedCommand.vue` (fallback); 🎤 on voice lines; hide deleted orders; demo-mode fake Assistant. Vitest for the hold/release and result state machines and timers. | W16–W18 pass; demo mode shows the full flow. |
| 3. Assistant (other repo) | [Assistant spec v3](/Users/vung.do/projects/zalo/zalo-order-assistant/spec.v3.md): poll `claim`, LLM extraction (`op`, name, quantity), name resolution (E7), Order API call (E6), `PATCH` the result. | W1–W4, W6–W10, W12 pass end to end against a staging project. |

Rollout: step 1 is additive (old web and the Assistant keep working). Step 2 can ship before step 3: commands then wait in `queued` and show *Trợ lý chưa nhận* (E10), so hide the talk bar behind `VITE_VOICE=1` until step 3 is live.
