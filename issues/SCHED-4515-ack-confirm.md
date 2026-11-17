---
id: SCHED-4515
title: Ack asks to confirm, and the confirm names the incident id
status: ready
plan: R2
---

Product's decision on the SCHED-4511 report. New incidents arrive at the top (R1) and the board refreshes
every 2 seconds (R4), so the rows move under the pointer. In the recording of build 4c41887, at 00:19, a
click aimed at INC-8247 acked INC-5550.

- New incidents stay live at the top, and Ack stays on the row.
- Ack opens a confirm (`data-testid="confirm"`) that names the incident id.
- `data-testid="confirm-ack"` sends the ack for the id the confirm names. `data-testid="confirm-cancel"` sends nothing.

Acceptance: a click that lands on the wrong row sends no ack; on-call reads the id, cancels, and acks the row they meant.
