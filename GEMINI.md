# Project: AIAIA Cochin Branch — Event Ticketing & Gate Management System
Ticketing Partner: Linear Atelier (linearatelier.com)
Target Scale: < 1,000 pax per event (~300–450 bookings)

## 1. Tech Stack & Runtime
- Framework: Next.js (App Router), TypeScript, Tailwind CSS
- Runtime: Bun / Node.js
- CMS / Super Admin Backoffice: Payload CMS (v3.93.x stable recommended; lock `/admin` strictly to `super_admin`)
- Database: Neon PostgreSQL (Singapore region) via `@payloadcms/db-postgres`
- Direct SQL / Hot Paths: Use `payload.db.drizzle` for atomic offline check-in syncs and Treasurer `SUM`/`GROUP BY` aggregations
- Offline PWA: IndexedDB (`Dexie.js`) + Service Worker + Ed25519 QR signing/verification (`@noble/ed25519`)
- Notifications:
  - WhatsApp: Meta WhatsApp Business Cloud API (Utility template; footer: `Linear Atelier · Ticketing Partner`)
  - Email Fallback: Plunk (`POST https://api.useplunk.com/v1/send`) using hosted PNG URLs for QR cards (never inline base64)
- Payments: Offline/manual tracking in V1; schema pre-wired (`gatewayProvider`, `gatewayRefId`) for Razorpay / Cashfree later

## 2. Route Architecture
- `/admin` — Payload Admin UI (`super_admin` ONLY)
- `/login` — Shared committee login via `POST /api/users/login` (Payload `httpOnly` JWT cookie)
- `/events/[id]` — Unified transparent committee dashboard (Overview, Bookings, Seating, Treasurer Summary, Live Attendance)
- `/desk` — Fast Booking Officer POS interface (booking creation, member lookup, table assignment, physical stub logging, cancellations/transfers)
- `/finance` — Treasurer verification queue, officer-wise cash reconciliation, and Excel/PDF AGM exports
- `/scan` — Installable offline-first Gate Check-In PWA + Door Sales entry

## 3. Auth, Transparency & RBAC Rules
- Reuse Payload's `users` auth collection with `roles` as a multi-select array (`hasMany: true`):
  `super_admin`, `treasurer`, `booking_officer`, `gate_staff`, `committee_member`
- **Universal Read Transparency:** Every authenticated user can READ all operational collections (`events`, `ticket-types`, `ticket-phases`, `event-tables`, `members`, `bookings`, `booking-tickets`, `ticket-checkin-slots`, `notification-logs`, `users`).
- **Field-Level Guardrails:**
  - `events.privateKeyEnc`: `access.read = () => false` (never exposed via API)
  - `bookings.treasurerVerified*`: writable ONLY by `treasurer` and `super_admin`
  - `bookings` core/seating/status fields: writable by `booking_officer` and `super_admin`
  - `ticket-checkin-slots`: `gate_staff` update access MUST enforce query constraint `{ checkedInAt: { exists: false } }` so checked-in slots lock permanently
- **Local API Rule:** Always pass `{ user, overrideAccess: false }` when running Payload Local API calls for logged-in committee routes. Only use `overrideAccess: true` inside verified server webhooks/system hooks.

## 4. Non-Negotiable Business Logic
1. **No Public Self-Signup in V1:** Officer-only booking entry. Keep `members` table ready for future self-booking.
2. **Member Subs Lookup:** Officer booking form searches `members` by name/phone/ID and displays subscription status (`active`, `arrears`, `inactive`), with graceful fallback to Guest if member DB is incomplete.
3. **Ticket Types × Phases:**
   - Types carry `paxMultiplier` (e.g., `Couple = 2`, `Stag = 1`, `Lady = 1`, `Kid = 1`).
   - Each type supports pricing phases: `Early-Bird`, `Phase 1`, `Door Sales / Walk-In`.
4. **1 Booking = 1 Master QR:**
   - Covers multiple tickets and multiple tables.
   - Always generate short human-readable codes on booking creation: Booking (`B042`) and Tickets (`B042-T01`, `B042-T02`).
   - Physical tickets: always use the pre-generated `bookingID-ticketID`. Officers can mark `physicalIssued` (with optional paper serial) anytime after booking.
5. **Smart Table Allocation:**
   - Tables are optional at booking time and can be added/changed later (triggering a one-tap WhatsApp/Plunk resend with the same Master QR).
   - Events support mixed fixed table capacities (e.g., 6, 8, 10) and optional `isShared` tables.
   - Always compute and display capacity recommendation (`Math.ceil(totalPax / tableCap)` -> `"N tables recommended for your booking"`) and validate `sum(assignedTableSeats) >= totalPax` with explicit warning if under-allocated.
6. **Offline Dead-Zone Check-In & Pre-Ticked Checklist:**
   - Officers pre-download the event roster to IndexedDB before arriving at the venue.
   - QR payload `{ bId, code, eId, pax, sig }` is signed with the event's Ed25519 private key and verified offline via the cached public key.
   - Scanning a Master QR (or manual lookup by `B042` / `B042-T01`) opens a checklist of all remaining pending attendee slots (`ticket_checkin_slots`, e.g. a `Couple` ticket expands to 2 slots), **checked by default**.
   - Officer unchecks absent guests and confirms. Once saved, checked slots **lock permanently** (`checkedInAt IS NOT NULL`) and cannot be unchecked by gate staff.
   - Offline sync is idempotent: batch-push slot check-ins to `/api/sync/checkins` using `UPDATE ticket_checkin_slots SET ... WHERE id = $1 AND checked_in_at IS NULL`.
7. **Payments & Audit Trail:**
   - V1 payment modes: `CASH`, `OFFICER_UPI`, `COMPLIMENTARY`, `PAY_AT_DOOR`.
   - Track `collectedByOfficer` on every booking for Treasurer collector-wise cash reconciliation.
   - Never hard-delete bookings; use `status: 'cancelled'` with audit history (`versions: true` on `bookings` and `members`; `versions: false` on `ticket-checkin-slots` and `notification-logs`).

## 5. Core Collections
- `users`: `name`, `phone`, `roles[]`
- `members`: `memberCode`, `fullName`, `phone`, `email`, `subsStatus`, `subsPaidUntil`
- `events`: `code`, `name`, `date`, `venue`, `publicKey`, `privateKeyEnc`
- `ticket-types`: `event`, `name`, `paxMultiplier`, `memberOnly`
- `ticket-phases`: `ticketType`, `phaseName`, `price`, `maxQty`, `isActive`
- `event-tables`: `event`, `tableLabel`, `maxCapacity`, `isShared`
- `bookings`: `bookingCode`, `event`, `member`, `holderName`, `phone`, `email`, `totalPax`, `totalAmount`, `status`, `qrSignature`, `paymentMode`, `paymentStatus`, `collectedByOfficer`, `treasurerVerified`, `treasurerVerifiedAt`, `treasurerVerifiedBy`, `gatewayProvider`, `gatewayRefId`
- `booking-tickets`: `booking`, `ticketCode`, `ticketPhase`, `paxCount`, `unitPrice`, `physicalIssued`, `physicalIssuedBy`, `physicalIssuedAt`, `paperSerialNo`
- `booking-tables`: `booking`, `table`, `allocatedSeats`, `assignedByOfficer`, `assignedAt`
- `ticket-checkin-slots`: `booking`, `bookingTicket`, `slotIndex`, `label`, `checkedInAt`, `checkedInByUser`, `deviceId`, `method`
- `notification-logs`: `booking`, `channel`, `trigger`, `status`, `providerMessageId`, `sentAt`