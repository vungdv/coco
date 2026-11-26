# Upgrade order — spec v2
[spec v1](spec.md): a Zalo Web reader (separate system) reads customer messages, de-duplicates them by message key, and publishes them to the Order API (`external_id` = message key).
Everything in v1 still holds unless this document replaces it.

## 1. Goal
Besides placing a pre-order, a customer can adjust it:
- **Reduce** it by x portions.
- **Set** it to x portions.
- **Cancel** it.

The kitchen sees **one row per customer order** with its running total and every message that shaped it.

**Non-goals (v2):** staff editing orders in the UI, prices, adjusting an order that has already been delivered.

## 2. Decisions
| # | Decision | Why |
|---|---|---|
| D1 | Customers are identified by `orders.customer_id`: the caller's `customer_id` (e.g. the Zalo user id) when sent, otherwise `lower(trim(customer_name))`. | Display names collide and change. Callers that send only a name keep working. |
| D2 | An **order** is one customer's open (undelivered) order for one `delivery_date`. A customer has at most one open order per day. When an `add` arrives and that day's order is already delivered, a **new order** is started, and the delivered one stays ticked. | The kitchen ticks off food that left the kitchen. New food is a new delivery. |
| D3 | **Order lines are immutable** (append-only ledger). An adjustment is a new line with a signed quantity. The order total is `sum(order_lines.quantity)`. | This gives an audit trail of what the customer asked for and when. There are no lost updates. |
| D4 | Replaying the same `(source, external_id)` with the same content is a no-op and returns `200` with the stored line. The same key with different content returns `409 Conflict`. This replaces v1 S18 (update in place). | Lines are immutable, and the reader already de-duplicates by message key. |
| D5 | The total never goes below 0. A reduce larger than the total is clamped: the line stores the effective delta, and `requested_quantity` keeps what was asked. | No negative portions. The audit trail still shows the request. |
| D6 | `reduce`, `set` and `cancel` with no open order for that customer and day return `409 Conflict` (`no_open_order`), and nothing is stored. | Delivered food can't be un-delivered (D2). The reader learns that the request did nothing. |
| D7 | An order whose total is 0 is **cancelled**. It stays listed (muted, at the bottom) so staff can see it was cancelled, but it is excluded from the counts. | Staff need to know not to cook it. |

Line math (the open order's current total is `sum`; the line's `quantity` is the delta that gets stored):

| op | Request | Stored `quantity` |
|---|---|---|
| `add` | x > 0 | `+x` |
| `reduce` | x > 0 | `-min(x, sum)` |
| `set` | x ≥ 0 | `x - sum` (the draft's `sum - x` had the sign reversed) |
| `cancel` | — | `-sum` |

## 3. Data model
### `orders` (header: delivery state, one per customer per delivery)
| Column | Notes |
|---|---|
| `id` uuid PK | unchanged ids, so v1 links and caches stay valid |
| `customer_id` text not null | D1; returned in API responses |
| `customer_name` text not null | latest name seen for this customer |
| `delivery_date` date not null | |
| `delivered`, `delivered_at`, `delivered_by` | unchanged; `set_delivered()` is still the only UI write |
| `created_at`, `updated_at` | `updated_at` is also bumped when a line is added, so Realtime on `orders` (filtered by `delivery_date`) fires |

Removed from `orders`: `source`, `external_id`, `quantity`, `message`, `placed_at`. These move to lines.
Index: `(delivery_date, customer_id) where not delivered` is **unique**, which enforces D2 (at most one open order).

### `order_lines` (immutable)
| Column | Notes |
|---|---|
| `id` uuid PK | |
| `order_id` uuid → `orders` `on delete cascade` | |
| `source` text not null, `external_id` text null | `unique (source, external_id)`: idempotency key (D4) |
| `op` text | `add` \| `reduce` \| `set` \| `cancel` |
| `requested_quantity` int null | what the caller asked for (null for cancel) |
| `quantity` int not null | signed effective delta (§2) |
| `message` text ≤ 2000 | |
| `placed_at` timestamptz not null default `now()` | message time |
| `created_at` timestamptz | |

- RLS: staff `select`. There are no client insert, update or delete grants. An `UPDATE` trigger rejects every change, which enforces D3.
- All writes go through `public.place_order_line(...)` (security definer, executable only by `service_role`). It takes a per-(customer, day) advisory lock, finds or creates the open order, computes the delta, and inserts the line, all in one transaction. Two concurrent messages from the same customer therefore can't both read the same `sum`.

### Migrations (forward-only)
- `20261126000000_order_lines.sql` (step 1):
  1. Create `order_lines`.
  2. Copy every v1 order into exactly one line (`op='add'`, same quantity, message, placed_at, source, external_id), keeping the order id.
  3. Set `customer_id = lower(trim(customer_name))`.
  4. Drop the moved columns.

  Orders are **not merged** and `place_order_line` creates one order per line, so the screen is unchanged (V18).
- `20261126010000_order_adjustments.sql` (step 2): merges each customer's open orders for a day into the oldest one by re-parenting their lines (totals unchanged), adds the unique open-order index (D2), and replaces `place_order_line` with the `op`/`customer_id` version.

## 4. Order API (`POST /functions/v1/orders`)
These fields are added to the v1 request. All of them are optional, so v1 callers are unchanged:
```json
{ "op": "reduce", "customer_id": "zalo:84901234567", "quantity": 2, "...": "v1 fields" }
```
- `op` defaults to `add`. `quantity` is required for `add`/`reduce` (> 0) and for `set` (≥ 0), and must be absent for `cancel`.
- `customer_name` is required for `add` only. For other ops it is used to find the order when `customer_id` is absent.

The response body is the order (v1 shape: `quantity` is now the **order total**) plus `line` (the stored line):

| Situation | Status |
|---|---|
| New line stored | `201` |
| Replay, same content (D4) | `200`, the existing line and its order |
| Same key, different content (D4) | `409` Problem Details, `error: "idempotency_conflict"` |
| `reduce`/`set`/`cancel` with no open order (D6) | `409`, `error: "no_open_order"` |
| Validation (v1 S21 rules plus op/quantity rules) | `422` |

Every other v1 rule (auth, 401/405/429, CORS) is unchanged.

## 5. UI
- One row per **order** (not per line). Its QTY is the order total.
- Its MESSAGE cell lists every line in `placed_at` order, as `+5  Em 5 suất nhé`, `−2  bớt 2 suất`, `=3 …`, `✕ hủy`, with each line's time. A line with no message shows only the delta.
- When a single line is an `add`, only the message shows, so it looks the same as v1.
- Row time (under NAME) = the first line's `placed_at`. Sort is unchanged: undelivered first, then by that time.
- **Cancelled** orders (total 0) sort after delivered orders, are muted with the label "Cancelled" / "Đã hủy", and have their checkbox disabled.
- Stats: **Orders** counts orders with total > 0 (remaining = also undelivered). **Portions** = sum of totals (remaining = undelivered). Cancelled orders and line counts never inflate either number.
- Demo mode and the offline cache use the same shape (`Order` with `lines[]`). An old cached v1 order is read as one `add` line.

## 6. Scenarios (Given/When/Then)
v1 S1–S17 and S19–S34 still apply. S18 is replaced by V5, and S23 by V8.

**Ledger**
- **V1 – Add.** Given no order for Lan today, When `add 5`, Then one order with total 5 and one line, `201`.
- **V2 – Second add merges.** Given Lan's open order is 5, When `add 2` (new message key), Then the same order has total 7 and two lines. The orders count stays 1.
- **V3 – Reduce.** Given total 7, When `reduce 3`, Then a `-3` line and total 4.
- **V4 – Reduce clamps.** Given total 4, When `reduce 10`, Then a `-4` line with `requested_quantity=10`, total 0 and the order shows as cancelled (D5, D7).
- **V5 – Replay.** Given a line stored for `(zalo, m1)`, When the same body is posted again, Then `200` and still one line. When posted with a different quantity, Then `409 idempotency_conflict` and nothing changes.
- **V6 – Set.** Given total 7, When `set 3`, Then a `-4` line and total 3. Given total 3, When `set 10`, Then `+7`. When `set 3` at total 3, Then a `0` line (recorded, no change).
- **V7 – Cancel.** Given total 7, When `cancel`, Then a `-7` line, total 0, listed as cancelled and excluded from counts.
- **V8 – Add after delivery.** Given Lan's order of 5 is delivered, When `add 2`, Then a **new** open order of 2 appears at the top. The delivered order still shows 5 and is ticked.
- **V9 – Adjust with no open order.** Given Lan's only order today is delivered (or she has none), When `reduce`/`set`/`cancel`, Then `409 no_open_order` and nothing is stored.
- **V10 – Re-add after cancel.** Given Lan's order is cancelled (total 0, undelivered), When `add 3`, Then the same order becomes total 3 and is no longer cancelled.
- **V11 – Customer identity.** Given two customers both named "Lan" with different `customer_id`, Then they are two orders. Given no `customer_id`, then "Lan" and " lan " are the same customer.
- **V12 – Concurrency.** Given two `set`/`reduce` requests for the same customer and day at once, Then they are applied one after the other, and the final total equals applying them in commit order.
- **V13 – Immutability.** Given any line, When anyone (including service role) issues an `UPDATE` on it, Then the database rejects it.
- **V14 – Undo delivered with another open order.** Given order A is delivered and order B is open for the same customer and day, When staff un-tick A, Then the toggle fails (unique open order) and the UI reverts with the v1 S10 toast.

**UI**
- **V15 – Row per customer.** Given Lan has 3 lines today, Then the list has one Lan row with QTY = total and 3 message lines, each with its delta and time.
- **V16 – Counts.** Given open orders of 5 and 2, one delivered order of 3 and one cancelled order, Then Orders `2/3` and Portions `7/10`.
- **V17 – Realtime.** Given staff has today open, When a `reduce` line is added via the API, Then the row's total and messages update within ~2 s.
- **V18 – Migration parity.** Given v1 data, When the migration runs, Then each v1 order has exactly one `add` line with the same quantity, message, placed_at and external_id, and the screen shows the same rows and numbers as before.

## 7. Plan
| Step | Scope | Done when |
|---|---|---|
| 1. Migrate the data model, no feature change | Migration (§3). `place_order_line` supports only `add`. The Edge Function calls it. The UI reads `orders` with embedded `order_lines` and renders exactly as v1. The one unavoidable API change is D4: an immutable line can't be updated in place, so S18 becomes replay or 409. | V18, V1, V5, V13 pass. The v1 UI and API tests are green. |
| 2. App logic & UI | `op`/`customer_id` in the API and function. Rows per order with multi-line messages and totals. Counts by order. Cancelled state. | V2–V12, V14–V17 pass. Demo data shows an adjusted order. |

### Rollout (the app is live: no step may break the running version)
Expand/contract. The step 1 migration adds computed fields `quantity`, `message` and `placed_at` on `orders`, so web clients built before v2 keep reading the old columns. Run the steps in this order:
1. `supabase db push`, immediately followed by `supabase functions deploy orders`. In the seconds between the two, the old Edge Function returns 500 and the Zalo reader retries. The old web keeps working.
2. Merge to `main`. CI deploys the new web. Doing this before step 1 breaks the new web, because `order_lines` doesn't exist yet.
3. Contract (later, separate migration): drop the `quantity`/`message`/`placed_at(orders)` compat functions once no tab is running a pre-v2 build.

Tests: pgTAP (`supabase/tests/*.sql`) for ledger math, D2, D4–D7 and immutability; Deno unit tests for request validation; Vitest for `summarize` and `sortOrders` and for formatting lines.
